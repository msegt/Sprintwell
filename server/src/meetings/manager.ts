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

const EVICT_AFTER_MS = 5 * 60_000;

const EMPTY_TIMER: TimerState = { endsAt: null, pausedRemainingMs: null, durationMs: 0 };

interface Runtime {
  record: MeetingRecord;
  queue: Promise<unknown>;
  timer?: NodeJS.Timeout;
  evict?: NodeJS.Timeout;
}

export interface Broadcaster {
  online(meetingId: string): string[];
  broadcastMeeting(meetingId: string, view: (userId: string) => MeetingView): void;
  notifyTeam(teamId: string): void;
}

export class MeetingManager {
  private cache = new Map<string, Runtime>();

  constructor(
    private readonly repo: Repo,
    private readonly out: Broadcaster,
  ) {}

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
      if (!role) throw forbidden('You are not a member of this team.');
      const members = await this.repo.members(r.teamId);
      const working: MeetingRecord = { ...r, timer: { ...r.timer }, state: structuredClone(r.state) };
      let teamTouched = false;
      const ctx = this.ctx(working, actorId, role, members, () => (teamTouched = true));

      const common = commonCommand.safeParse(raw);
      if (common.success) {
        this.applyCommon(ctx, common.data);
      } else {
        if (r.endedAt) throw new MeetingError('This meeting has ended. The facilitator can reopen it.');
        const engine = ENGINES[r.kind];
        const parsed = engine.schema.safeParse(raw);
        if (!parsed.success) throw new MeetingError('That command is not valid.');
        if (engine.facilitatorOnly.has(parsed.data.type) && !ctx.isFacilitator) {
          throw new MeetingError('Only the facilitator can do that.');
        }
        await engine.apply(ctx, parsed.data);
      }

      const listChanged = working.phase !== r.phase || working.title !== r.title || working.endedAt !== r.endedAt || working.facilitatorId !== r.facilitatorId;
      runtime.record = { ...working, state: ctx.state, updatedAt: now() };
      await this.persist(runtime);
      this.scheduleTimer(runtime);
      this.broadcast(runtime);
      if (teamTouched || listChanged) this.out.notifyTeam(r.teamId);
    });
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
    clearTimeout(runtime.timer);
    const engine = ENGINES[runtime.record.kind];
    const endsAt = runtime.record.timer.endsAt;
    if (!engine.onTimerEnd || !endsAt || runtime.record.endedAt) return;
    runtime.timer = setTimeout(() => {
      void this.enqueue(runtime, async () => {
        const r = runtime.record;
        if (r.timer.endsAt !== endsAt) return;
        const working: MeetingRecord = { ...r, timer: { ...r.timer }, state: structuredClone(r.state) };
        const members = await this.repo.members(r.teamId);
        const ctx = this.ctx(working, r.facilitatorId, 'member', members, () => undefined);
        if (engine.onTimerEnd!(ctx)) {
          runtime.record = { ...working, state: ctx.state, updatedAt: now() };
          await this.persist(runtime);
          this.scheduleTimer(runtime);
          this.broadcast(runtime);
        }
      }).catch(() => undefined);
    }, Math.max(0, endsAt - Date.now()));
    runtime.timer.unref?.();
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
    const id = runtime.record.id;
    if (this.out.online(id).length > 0) return;
    runtime.evict = setTimeout(() => {
      if (this.out.online(id).length > 0) return;
      const timerDriven = !!ENGINES[runtime.record.kind].onTimerEnd && !!runtime.record.timer.endsAt && !runtime.record.endedAt;
      if (timerDriven) {
        this.scheduleEviction(runtime);
        return;
      }
      clearTimeout(runtime.timer);
      if (this.cache.get(id) === runtime) this.cache.delete(id);
    }, EVICT_AFTER_MS);
    runtime.evict.unref?.();
  }

  async remove(meetingId: string): Promise<void> {
    const runtime = this.cache.get(meetingId);
    if (runtime) {
      clearTimeout(runtime.timer);
      clearTimeout(runtime.evict);
    }
    this.cache.delete(meetingId);
    await this.repo.db.deleteFrom('meetings').where('id', '=', meetingId).execute();
  }

  /** Forgets cached meetings of a deleted team. */
  forgetTeam(teamId: string): void {
    for (const [id, rt] of this.cache) {
      if (rt.record.teamId === teamId) {
        clearTimeout(rt.timer);
        clearTimeout(rt.evict);
        this.cache.delete(id);
      }
    }
  }

  async summaryMarkdown(meetingId: string): Promise<{ filename: string; markdown: string }> {
    const runtime = await this.load(meetingId);
    const r = runtime.record;
    const engine = ENGINES[r.kind];
    const actions = await this.repo.db.selectFrom('actions').selectAll().where('team_id', '=', r.teamId).where('meeting_id', '=', r.id).execute();
    const team = await this.repo.db.selectFrom('teams').select('name').where('id', '=', r.teamId).executeTakeFirst();
    const sprint = r.sprintId ? await this.repo.db.selectFrom('sprints').selectAll().where('id', '=', r.sprintId).executeTakeFirst() : undefined;
    const ids = new Set<string>([r.facilitatorId, ...actions.map((a) => a.owner_id ?? '')]);
    collectIds(r.state, ids);
    const nameMap = await this.repo.userNames([...ids].filter(Boolean));
    const names = (id: string | null | undefined) => (id ? (nameMap[id] ?? 'Someone') : 'Unassigned');

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
