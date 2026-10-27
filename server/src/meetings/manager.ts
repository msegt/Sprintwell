import {
  LIMITS,
  MEETING_INFO,
  PHASES,
  type MeetingKind,
  type MeetingView,
  type MemberDTO,
  type TeamRole,
  type TimerState,
} from '@sprintwell/shared';
import {
  commonCommand,
} from '@sprintwell/shared/schemas';
import type { Repo } from '../repo';
import { forbidden, notFound, now, newId, parseJson } from '../util';
import { logActivity } from '../activity';
import { attendance, describeCommand } from './activity';
import { MeetingError, md, type Engine, type EngineCtx, type MeetingRecord } from './engine';
import { dailyEngine, pairingEngine, planningEngine, reviewEngine } from './others';
import { pokerEngine } from './poker';
import { retroEngine } from './retro';

type AnyEngine = Engine<any, any, any>;

export const ENGINES: Record<MeetingKind, AnyEngine> = {
  poker: pokerEngine,
  retro: retroEngine,
  daily: dailyEngine,
  planning: planningEngine,
  review: reviewEngine,
  pairing: pairingEngine,
};

type Handle = ReturnType<typeof setTimeout>;

/**
 * Schedules server-side timer callbacks (pairing rotation). Node uses
 * setTimeout; Cloudflare Durable Objects use storage alarms so timers survive
 * hibernation.
 */
export interface TimerHost {
  set(meetingId: string, at: number): void;
  clear(meetingId: string): void;
}

export interface ManagerOptions {
  /** null disables server-side timers (e.g. in a stateless request handler). Default: setTimeout. */
  timers?: TimerHost | null;
  /** Drop idle meetings from memory after this many ms; null to never evict. Default 5 minutes. */
  evictAfterMs?: number | null;
  /** false: always read meetings from the database (for stateless request handlers). Default true. */
  cache?: boolean;
}

/** Events idle for longer than this end automatically. */
export const STALE_AFTER_MS = 6 * 60 * 60_000;

const EMPTY_TIMER: TimerState = { endsAt: null, pausedRemainingMs: null, durationMs: 0 };

interface Runtime {
  record: MeetingRecord;
  queue: Promise<unknown>;
  evict?: Handle;
}

export interface Broadcaster {
  online(meetingId: string): string[];
  broadcastMeeting(meetingId: string, view: (userId: string) => MeetingView): void;
  notifyTeam(teamId: string): void;
}

export class MeetingManager {
  private cache = new Map<string, Runtime>();
  private readonly timers: TimerHost | null;
  private readonly evictAfterMs: number | null;
  private readonly useCache: boolean;

  constructor(
    private readonly repo: Repo,
    private readonly out: Broadcaster,
    options: ManagerOptions = {},
  ) {
    this.timers = options.timers === undefined ? new TimeoutTimers((id) => void this.fireTimer(id)) : options.timers;
    this.evictAfterMs = options.evictAfterMs === undefined ? 5 * 60_000 : options.evictAfterMs;
    this.useCache = options.cache ?? true;
  }

  async create(teamId: string, actorId: string, input: { kind: MeetingKind; title?: string; sprintId?: string | null; options: Record<string, unknown> }): Promise<string> {
    const engine = ENGINES[input.kind];
    await this.repo.assertRoom('meetings', teamId, 1, LIMITS.meetingsPerTeam, 'events');
    const team = await this.repo.team(teamId, 'member');
    if (input.sprintId) await this.repo.sprint(teamId, input.sprintId);
    const createInput = { teamId, actorId, sprintId: input.sprintId ?? null, options: input.options, members: team.members, settings: team.settings, repo: this.repo };
    const created = await engine.create(createInput);
    const sprintId = created.sprintId !== undefined ? created.sprintId : (input.sprintId ?? null);
    const title = input.title?.trim() || (await engine.defaultTitle({ ...createInput, sprintId }));
    const ts = now();
    const id = newId();
    const phase = PHASES[input.kind][0]!.id;
    await this.repo.db
      .insertInto('meetings')
      .values({
        id,
        team_id: teamId,
        kind: input.kind,
        title,
        sprint_id: sprintId,
        facilitator_id: actorId,
        phase,
        state: JSON.stringify({ timer: EMPTY_TIMER, data: created.state }),
        created_at: ts,
        updated_at: ts,
        ended_at: null,
      })
      .execute();
    this.out.notifyTeam(teamId);
    return id;
  }

  /** Loads a meeting, checking that it belongs to `teamId` when given. */
  async load(id: string): Promise<Runtime> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = await this.repo.db.selectFrom('meetings').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Meeting not found');
    // Another load may have finished while we awaited.
    const again = this.cache.get(id);
    if (again) return again;
    const stored = parseJson<{ timer: TimerState; data: unknown }>(row.state, { timer: EMPTY_TIMER, data: {} });
    const runtime: Runtime = {
      record: {
        id: row.id,
        teamId: row.team_id,
        kind: row.kind as MeetingKind,
        title: row.title,
        sprintId: row.sprint_id,
        facilitatorId: row.facilitator_id,
        phase: row.phase,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        endedAt: row.ended_at,
        timer: stored.timer ?? EMPTY_TIMER,
        state: stored.data,
      },
      queue: Promise.resolve(),
    };
    if (!this.useCache) return runtime;
    this.cache.set(id, runtime);
    this.scheduleTimer(runtime);
    this.scheduleEviction(runtime);
    return runtime;
  }

  async teamOf(meetingId: string): Promise<string> {
    return (await this.load(meetingId)).record.teamId;
  }

  view(runtime: Runtime, viewerId: string): MeetingView {
    const r = runtime.record;
    const online = this.out.online(r.id);
    const engine = ENGINES[r.kind];
    return {
      id: r.id,
      teamId: r.teamId,
      kind: r.kind,
      title: r.title,
      phase: r.phase,
      facilitatorId: r.facilitatorId,
      sprintId: r.sprintId,
      timer: r.timer,
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      online,
      serverNow: Date.now(),
      data: engine.view(r.state, viewerId, r, online),
    } as MeetingView;
  }

  async viewFor(meetingId: string, viewerId: string): Promise<MeetingView> {
    return this.view(await this.load(meetingId), viewerId);
  }

  broadcast(runtime: Runtime): void {
    this.out.broadcastMeeting(runtime.record.id, (userId) => this.view(runtime, userId));
  }

  /** Serialises work per meeting so concurrent commands never interleave. */
  private enqueue<T>(runtime: Runtime, fn: () => Promise<T>): Promise<T> {
    const next = runtime.queue.then(fn, fn);
    runtime.queue = next.catch(() => undefined);
    return next;
  }

  async command(meetingId: string, actorId: string, raw: unknown): Promise<void> {
    const runtime = await this.load(meetingId);
    return this.enqueue(runtime, async () => {
      const r = runtime.record;
      const role = await this.repo.membership(r.teamId, actorId);
      if (!role) {
        if ((await this.repo.access(r.teamId, actorId)) === 'coach') throw new MeetingError('Teaching staff can watch events but not take part.');
        throw forbidden('You are not a member of this team.');
      }
      const members = await this.repo.members(r.teamId);
      const working: MeetingRecord = { ...r, timer: { ...r.timer }, state: structuredClone(r.state) };
      let teamTouched = false;
      const ctx = this.ctx(working, actorId, role, members, () => (teamTouched = true));

      const common = commonCommand.safeParse(raw);
      let applied: { type: string } & Record<string, unknown>;
      if (common.success) {
        this.applyCommon(ctx, common.data);
        applied = common.data;
      } else {
        if (r.endedAt) throw new MeetingError('This meeting has ended. The facilitator can reopen it.');
        const engine = ENGINES[r.kind];
        const parsed = engine.schema.safeParse(raw);
        if (!parsed.success) throw new MeetingError('That command is not valid.');
        if (engine.facilitatorOnly.has(parsed.data.type) && !ctx.isFacilitator) {
          throw new MeetingError('Only the facilitator can do that.');
        }
        await engine.apply(ctx, parsed.data);
        applied = parsed.data as { type: string } & Record<string, unknown>;
      }

      const listChanged = working.phase !== r.phase || working.title !== r.title || working.endedAt !== r.endedAt || working.facilitatorId !== r.facilitatorId;
      runtime.record = { ...working, state: ctx.state, updatedAt: now() };
      await this.persist(runtime);
      this.scheduleTimer(runtime);
      this.broadcast(runtime);
      if (teamTouched || listChanged) this.out.notifyTeam(r.teamId);
      const entries = describeCommand(r, runtime.record, actorId, applied);
      if (entries.length) await logActivity(this.repo.db, entries.map((e) => ({ ...e, teamId: r.teamId })));
    });
  }

  /** Records that a team member joined an event (once per person and event). */
  async recordAttendance(meetingId: string, userId: string): Promise<void> {
    const runtime = await this.load(meetingId).catch(() => null);
    if (!runtime || runtime.record.endedAt) return;
    await logActivity(this.repo.db, attendance(runtime.record, userId));
  }

  private ctx(working: MeetingRecord, actorId: string, role: TeamRole, members: MemberDTO[], touch: () => void): EngineCtx<unknown> {
    return {
      meeting: working,
      state: working.state,
      actorId,
      isFacilitator: working.facilitatorId === actorId,
      isAdmin: role === 'admin',
      online: this.out.online(working.id),
      members,
      repo: this.repo,
      touchTeam: touch,
      startTimer: (seconds) => {
        working.timer = { endsAt: Date.now() + seconds * 1000, pausedRemainingMs: null, durationMs: seconds * 1000 };
      },
      stopTimer: () => {
        working.timer = { ...EMPTY_TIMER };
      },
    };
  }

  private applyCommon(ctx: EngineCtx<unknown>, cmd: ReturnType<typeof commonCommand.parse>): void {
    const m = ctx.meeting;
    const facilitatorOrAdmin = ctx.isFacilitator || ctx.isAdmin;
    const needFacilitator = () => {
      if (!ctx.isFacilitator) throw new MeetingError('Only the facilitator can do that.');
    };
    switch (cmd.type) {
      case 'setPhase':
        needFacilitator();
        if (m.endedAt) throw new MeetingError('This meeting has ended.');
        if (!PHASES[m.kind].some((p) => p.id === cmd.phase)) throw new MeetingError('Unknown step.');
        m.phase = cmd.phase;
        break;
      case 'timerStart':
        needFacilitator();
        ctx.startTimer(cmd.seconds);
        break;
      case 'timerPause':
        needFacilitator();
        if (m.timer.endsAt) m.timer = { ...m.timer, endsAt: null, pausedRemainingMs: Math.max(0, m.timer.endsAt - Date.now()) };
        break;
      case 'timerResume':
        needFacilitator();
        if (m.timer.pausedRemainingMs !== null) m.timer = { ...m.timer, endsAt: Date.now() + m.timer.pausedRemainingMs, pausedRemainingMs: null };
        break;
      case 'timerStop':
        needFacilitator();
        ctx.stopTimer();
        break;
      case 'handover':
        if (!facilitatorOrAdmin) throw new MeetingError('Only the facilitator or a team admin can hand over.');
        if (!ctx.members.some((x) => x.userId === cmd.userId)) throw new MeetingError('That person is not in the team.');
        m.facilitatorId = cmd.userId;
        break;
      case 'claimFacilitator': {
        const facilitatorHere = ctx.online.includes(m.facilitatorId) && ctx.members.some((x) => x.userId === m.facilitatorId);
        if (facilitatorHere && !ctx.isAdmin) throw new MeetingError('The facilitator is here. Ask them to hand over.');
        m.facilitatorId = ctx.actorId;
        break;
      }
      case 'rename':
        if (!facilitatorOrAdmin) throw new MeetingError('Only the facilitator can rename the meeting.');
        m.title = cmd.title;
        break;
      case 'end':
        if (!facilitatorOrAdmin) throw new MeetingError('Only the facilitator can end the meeting.');
        m.endedAt = now();
        ctx.stopTimer();
        break;
      case 'reopen':
        if (!facilitatorOrAdmin) throw new MeetingError('Only the facilitator can reopen the meeting.');
        m.endedAt = null;
        break;
    }
  }

  private async persist(runtime: Runtime): Promise<void> {
    const r = runtime.record;
    await this.repo.db
      .updateTable('meetings')
      .set({
        title: r.title,
        phase: r.phase,
        facilitator_id: r.facilitatorId,
        ended_at: r.endedAt,
        updated_at: r.updatedAt,
        state: JSON.stringify({ timer: r.timer, data: r.state }),
      })
      .where('id', '=', r.id)
      .execute();
  }

  /** Server-side timer only for engines that react to it (e.g. pairing rotation). */
  private scheduleTimer(runtime: Runtime): void {
    if (!this.timers) return;
    const engine = ENGINES[runtime.record.kind];
    const endsAt = runtime.record.timer.endsAt;
    if (!engine.onTimerEnd || !endsAt || runtime.record.endedAt) this.timers.clear(runtime.record.id);
    else this.timers.set(runtime.record.id, endsAt);
  }

  /** Runs a meeting's timer-end behaviour if its timer is due. Safe to call early or twice. */
  async fireTimer(meetingId: string): Promise<void> {
    const runtime = await this.load(meetingId).catch(() => null);
    if (!runtime) return;
    const engine = ENGINES[runtime.record.kind];
    if (!engine.onTimerEnd) return;
    await this.enqueue(runtime, async () => {
      const r = runtime.record;
      if (!r.timer.endsAt || r.endedAt) return;
      if (r.timer.endsAt > Date.now() + 50) {
        this.scheduleTimer(runtime);
        return;
      }
      const working: MeetingRecord = { ...r, timer: { ...r.timer }, state: structuredClone(r.state) };
      const members = await this.repo.members(r.teamId);
      const ctx = this.ctx(working, r.facilitatorId, 'member', members, () => undefined);
      if (engine.onTimerEnd!(ctx)) {
        runtime.record = { ...working, state: ctx.state, updatedAt: now() };
        await this.persist(runtime);
        this.broadcast(runtime);
      }
      this.scheduleTimer(runtime);
    }).catch(() => undefined);
  }

  /** Called by the hub when someone joins or leaves a meeting room. */
  async presenceChanged(meetingId: string): Promise<void> {
    const runtime = this.cache.get(meetingId);
    if (!runtime) return;
    clearTimeout(runtime.evict);
    const engine = ENGINES[runtime.record.kind];
    await this.enqueue(runtime, async () => {
      if (engine.onPresence && !runtime.record.endedAt) {
        const r = runtime.record;
        const working: MeetingRecord = { ...r, timer: { ...r.timer }, state: structuredClone(r.state) };
        const ctx = this.ctx(working, r.facilitatorId, 'member', [], () => undefined);
        if (engine.onPresence(ctx)) {
          runtime.record = { ...working, state: ctx.state, updatedAt: now() };
          await this.persist(runtime);
        }
      }
      this.broadcast(runtime);
    }).catch(() => undefined);
    this.scheduleEviction(runtime);
  }

  /**
   * Drops a meeting from memory once nobody has been connected for a while.
   * Meetings with a running server-side timer (pairing rotation) stay loaded
   * so the timer keeps firing.
   */
  private scheduleEviction(runtime: Runtime): void {
    clearTimeout(runtime.evict);
    if (this.evictAfterMs === null) return;
    const id = runtime.record.id;
    if (this.out.online(id).length > 0) return;
    runtime.evict = setTimeout(() => {
      if (this.out.online(id).length > 0) return;
      const timerDriven = !!ENGINES[runtime.record.kind].onTimerEnd && !!runtime.record.timer.endsAt && !runtime.record.endedAt;
      if (timerDriven) {
        this.scheduleEviction(runtime);
        return;
      }
      if (this.cache.get(id) === runtime) this.cache.delete(id);
    }, this.evictAfterMs);
    (runtime.evict as { unref?: () => void }).unref?.();
  }

  /**
   * Ends events nobody has touched for a while, so forgotten events do not stay
   * "in progress" for ever. Returns the ids of the events it ended.
   */
  async endStale(teamId: string, idleMs = STALE_AFTER_MS): Promise<string[]> {
    const cutoff = new Date(Date.now() - idleMs).toISOString();
    const stale = await this.repo.db
      .selectFrom('meetings')
      .select('id')
      .where('team_id', '=', teamId)
      .where('ended_at', 'is', null)
      .where('updated_at', '<', cutoff)
      .execute();
    const ended: string[] = [];
    if (stale.length === 0) return ended;
    const ts = now();
    for (const { id } of stale) {
      const cached = this.cache.get(id);
      // A meeting still in use in this process is not stale.
      if (cached && Date.parse(cached.record.updatedAt) >= Date.parse(cutoff)) continue;
      await this.repo.db.updateTable('meetings').set({ ended_at: ts }).where('id', '=', id).where('ended_at', 'is', null).execute();
      this.forget(id);
      ended.push(id);
    }
    return ended;
  }

  /** Forgets a cached meeting (after it was deleted elsewhere). */
  forget(meetingId: string): void {
    const runtime = this.cache.get(meetingId);
    if (runtime) clearTimeout(runtime.evict);
    this.timers?.clear(meetingId);
    this.cache.delete(meetingId);
  }

  async remove(meetingId: string): Promise<void> {
    this.forget(meetingId);
    await this.repo.db.deleteFrom('meetings').where('id', '=', meetingId).execute();
  }

  /** Forgets cached meetings of a deleted team. */
  forgetTeam(teamId: string): void {
    for (const [id, rt] of this.cache) {
      if (rt.record.teamId === teamId) this.forget(id);
    }
  }

  async summaryMarkdown(meetingId: string): Promise<{ filename: string; markdown: string }> {
    const runtime = await this.load(meetingId);
    const [summary] = await this.summarise(runtime.record.teamId, [runtime.record]);
    return summary!;
  }

  /** Summaries of every meeting of a team, with a fixed number of queries (D1 limits subrequests). */
  async teamSummaries(teamId: string): Promise<Map<string, string>> {
    const rows = await this.repo.db.selectFrom('meetings').selectAll().where('team_id', '=', teamId).orderBy('created_at', 'desc').limit(200).execute();
    const records = rows.map((row) => {
      const cached = this.cache.get(row.id);
      if (cached) return cached.record;
      const stored = parseJson<{ timer: TimerState; data: unknown }>(row.state, { timer: EMPTY_TIMER, data: {} });
      return {
        id: row.id,
        teamId: row.team_id,
        kind: row.kind as MeetingKind,
        title: row.title,
        sprintId: row.sprint_id,
        facilitatorId: row.facilitator_id,
        phase: row.phase,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        endedAt: row.ended_at,
        timer: stored.timer ?? EMPTY_TIMER,
        state: stored.data,
      } satisfies MeetingRecord;
    });
    const out = new Map<string, string>();
    const summaries = await this.summarise(teamId, records);
    records.forEach((r, i) => out.set(r.id, summaries[i]!.markdown));
    return out;
  }

  private async summarise(teamId: string, records: MeetingRecord[]): Promise<{ filename: string; markdown: string }[]> {
    const [allActions, team, sprints] = await Promise.all([
      this.repo.db.selectFrom('actions').selectAll().where('team_id', '=', teamId).where('meeting_id', 'is not', null).execute(),
      this.repo.db.selectFrom('teams').select('name').where('id', '=', teamId).executeTakeFirst(),
      this.repo.db.selectFrom('sprints').selectAll().where('team_id', '=', teamId).execute(),
    ]);
    const ids = new Set<string>(allActions.map((a) => a.owner_id ?? ''));
    for (const r of records) {
      ids.add(r.facilitatorId);
      collectIds(r.state, ids);
    }
    const nameMap = await this.repo.userNames([...ids].filter(Boolean));
    const names = (id: string | null | undefined) => (id ? (nameMap[id] ?? 'Someone') : 'Unassigned');

    return records.map((r) => {
      const engine = ENGINES[r.kind];
      const actions = allActions.filter((a) => a.meeting_id === r.id);
      const sprint = r.sprintId ? sprints.find((sp) => sp.id === r.sprintId) : undefined;
      const lines = [
        `# ${md(r.title)}`,
        '',
        `- Team: ${md(team?.name ?? '')}`,
        `- Event: ${MEETING_INFO[r.kind].name}`,
        `- Date: ${r.createdAt.slice(0, 10)}`,
        `- Facilitator: ${md(names(r.facilitatorId))}`,
        ...(sprint ? [`- Sprint: ${md(sprint.name)}${sprint.goal ? ` (Sprint Goal: ${md(sprint.goal)})` : ''}`] : []),
        `- Status: ${r.endedAt ? `ended ${r.endedAt.slice(0, 16).replace('T', ' ')} UTC` : 'in progress'}`,
        '',
        '## Summary',
        '',
        engine.summary(r.state, r, names),
      ];
      if (actions.length) {
        lines.push('', '## Actions', '');
        for (const a of actions) lines.push(`- [${a.status === 'done' ? 'x' : ' '}] ${md(a.text)} (owner: ${md(names(a.owner_id))}${a.due_date ? `, due ${a.due_date}` : ''})`);
      }
      lines.push('', `_Exported from Sprintwell on ${new Date().toISOString().slice(0, 10)}._`, '');
      const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'meeting';
      return { filename: `${r.createdAt.slice(0, 10)}-${slug}.md`, markdown: lines.join('\n') };
    });
  }
}

/** Finds user ids referenced anywhere in meeting state (keys and values that look like ids are resolved lazily). */
function collectIds(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (/^[0-9a-z]{16}$/.test(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectIds(v, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^[0-9a-z]{16}$/.test(k)) into.add(k);
      collectIds(v, into, depth + 1);
    }
  }
}

/** Default timer host for a long-running Node process. */
class TimeoutTimers implements TimerHost {
  private handles = new Map<string, Handle>();
  constructor(private readonly fire: (meetingId: string) => void) {}
  set(meetingId: string, at: number): void {
    this.clear(meetingId);
    const h = setTimeout(() => {
      this.handles.delete(meetingId);
      this.fire(meetingId);
    }, Math.max(0, at - Date.now()));
    (h as { unref?: () => void }).unref?.();
    this.handles.set(meetingId, h);
  }
  clear(meetingId: string): void {
    const h = this.handles.get(meetingId);
    if (h) clearTimeout(h);
    this.handles.delete(meetingId);
  }
}
