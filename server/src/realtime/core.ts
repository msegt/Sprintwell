import type { ClientMessage, MeetingView, ServerMessage } from '@sprintwell/shared';
import { MeetingError } from '../meetings/engine';
import type { Broadcaster, MeetingManager } from '../meetings/manager';
import type { Repo } from '../repo';
import { HttpError } from '../util';

/**
 * Serialisable per-connection state. On Cloudflare it is stored as the
 * WebSocket attachment so it survives Durable Object hibernation.
 */
export interface ConnState {
  userId: string | null;
  teams: string[];
  /** meetingId -> teamId */
  meetings: Record<string, string>;
  /** Teams this connection watches as teaching staff: they do not count as present in events. */
  watching?: string[];
}

export const EMPTY_CONN_STATE: ConnState = { userId: null, teams: [], meetings: {}, watching: [] };

/** A transport-neutral view of one WebSocket connection. */
export interface Connection {
  /** Stable object identifying the connection while it is in memory. */
  readonly key: object;
  getState(): ConnState;
  setState(state: ConnState): void;
  send(text: string): void;
  close(code: number, reason: string): void;
}

export interface ConnectionStore {
  all(): Connection[];
}

export interface Log {
  warn(obj: unknown, msg: string): void;
  error(obj: unknown, msg: string): void;
}

const MAX_TOKENS = 40;
const REFILL_PER_SEC = 20;

/**
 * The real-time protocol: authentication, team subscriptions, meeting rooms,
 * commands and broadcasts. Used by the Node hub and by the Cloudflare
 * Durable Object, which only differ in how connections are stored.
 */
export class Realtime implements Broadcaster {
  manager!: MeetingManager;
  private buckets = new WeakMap<object, { tokens: number; last: number }>();
  private pendingTeams = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly repo: Repo,
    private readonly log: Log,
    private readonly store: ConnectionStore,
    /** When set, only this team's data and meetings are served (one Durable Object per team). */
    private readonly teamScope: string | null = null,
  ) {}

  dispose(): void {
    for (const t of this.pendingTeams.values()) clearTimeout(t);
  }

  async onMessage(conn: Connection, raw: string): Promise<void> {
    if (!this.take(conn)) {
      this.send(conn, { t: 'error', error: 'Slow down a little.' });
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    try {
      await this.handle(conn, msg);
    } catch (err) {
      this.log.warn({ err }, 'ws message failed');
    }
  }

  /** Call when a connection closes. */
  async onClose(conn: Connection): Promise<void> {
    const meetings = Object.keys(conn.getState().meetings);
    conn.setState({ ...EMPTY_CONN_STATE });
    for (const id of meetings) await this.manager.presenceChanged(id);
  }

  private take(conn: Connection): boolean {
    const t = Date.now();
    const b = this.buckets.get(conn.key) ?? { tokens: MAX_TOKENS, last: t };
    b.tokens = Math.min(MAX_TOKENS, b.tokens + ((t - b.last) / 1000) * REFILL_PER_SEC);
    b.last = t;
    this.buckets.set(conn.key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private async handle(conn: Connection, msg: ClientMessage): Promise<void> {
    if (msg.t === 'ping') return this.send(conn, { t: 'pong' });
    const state = conn.getState();
    if (msg.t === 'auth') {
      // A socket keeps one identity for its lifetime; switching would keep old subscriptions alive.
      if (state.userId) return this.send(conn, { t: 'error', error: 'Already signed in' });
      const user = typeof msg.token === 'string' ? await this.repo.userForToken(msg.token) : null;
      if (!user) {
        conn.close(4001, 'Invalid session');
        return;
      }
      conn.setState({ ...state, userId: user.id });
      return this.send(conn, { t: 'ready', userId: user.id });
    }
    const userId = state.userId;
    if (!userId) return this.send(conn, { t: 'error', error: 'Not signed in' });

    switch (msg.t) {
      case 'sub': {
        const teamId = msg.teamId;
        const access = typeof teamId === 'string' && !(this.teamScope && teamId !== this.teamScope) ? await this.repo.access(teamId, userId) : null;
        if (!access) return this.send(conn, { t: 'error', error: 'Not a member of that team' });
        const s = conn.getState();
        const watching = s.watching ?? [];
        conn.setState({ ...s, teams: s.teams.includes(teamId) ? s.teams : [...s.teams, teamId], watching: access === 'coach' ? [...new Set([...watching, teamId])] : watching.filter((t) => t !== teamId) });
        return;
      }
      case 'unsub': {
        const s = conn.getState();
        conn.setState({ ...s, teams: s.teams.filter((t) => t !== msg.teamId) });
        return;
      }
      case 'join': {
        const meetingId = String(msg.meetingId);
        try {
          const teamId = await this.manager.teamOf(meetingId);
          if (this.teamScope && teamId !== this.teamScope) throw new Error('wrong team');
          const access = await this.repo.access(teamId, userId);
          if (!access) throw new Error('forbidden');
          const s = conn.getState();
          const watching = s.watching ?? [];
          conn.setState({ ...s, meetings: { ...s.meetings, [meetingId]: teamId }, watching: access === 'coach' ? [...new Set([...watching, teamId])] : watching });
          if (access !== 'coach') await this.manager.recordAttendance(meetingId, userId);
          // Send the joiner a view straight away, then tell everyone about the new presence.
          this.send(conn, { t: 'meeting', view: await this.manager.viewFor(meetingId, userId) });
          await this.manager.presenceChanged(meetingId);
        } catch {
          this.send(conn, { t: 'error', error: 'Meeting not found' });
        }
        return;
      }
      case 'leave': {
        const s = conn.getState();
        if (msg.meetingId in s.meetings) {
          const meetings = { ...s.meetings };
          delete meetings[msg.meetingId];
          conn.setState({ ...s, meetings });
          await this.manager.presenceChanged(msg.meetingId);
        }
        return;
      }
      case 'cmd': {
        if (!(msg.meetingId in conn.getState().meetings)) {
          return this.send(conn, { t: 'ack', id: msg.id, ok: false, error: 'Join the meeting first.' });
        }
        try {
          await this.manager.command(msg.meetingId, userId, msg.cmd);
          this.send(conn, { t: 'ack', id: msg.id, ok: true });
        } catch (err) {
          const known = err instanceof MeetingError || err instanceof HttpError;
          if (!known) this.log.error({ err }, 'meeting command failed');
          this.send(conn, { t: 'ack', id: msg.id, ok: false, error: known ? (err as Error).message : 'Something went wrong. Please try again.' });
        }
        return;
      }
    }
  }

  private send(conn: Connection, msg: ServerMessage): void {
    conn.send(JSON.stringify(msg));
  }

  // ------------------------------------------------------------ Broadcaster

  private inRoom(meetingId: string): Connection[] {
    return this.store.all().filter((c) => meetingId in c.getState().meetings);
  }

  /** Team members connected to an event. Teaching staff watching it are not counted. */
  online(meetingId: string): string[] {
    const ids = this.inRoom(meetingId)
      .filter((c) => {
        const s = c.getState();
        return !(s.watching ?? []).includes(s.meetings[meetingId] ?? '');
      })
      .map((c) => c.getState().userId);
    return [...new Set(ids.filter((id): id is string => !!id))];
  }

  broadcastMeeting(meetingId: string, view: (userId: string) => MeetingView): void {
    const cache = new Map<string, string>();
    for (const c of this.inRoom(meetingId)) {
      const userId = c.getState().userId;
      if (!userId) continue;
      let payload = cache.get(userId);
      if (!payload) {
        payload = JSON.stringify({ t: 'meeting', view: view(userId) } satisfies ServerMessage);
        cache.set(userId, payload);
      }
      c.send(payload);
    }
  }

  /** Tells subscribers that team data changed; debounced so bursts become one refresh. */
  notifyTeam(teamId: string): void {
    if (this.pendingTeams.has(teamId)) return;
    this.pendingTeams.set(
      teamId,
      setTimeout(() => {
        this.pendingTeams.delete(teamId);
        const payload = JSON.stringify({ t: 'team', teamId } satisfies ServerMessage);
        for (const c of this.store.all()) if (c.getState().teams.includes(teamId)) c.send(payload);
      }, 40),
    );
  }

  /** Disconnects a person from a team's live data (after removal or account deletion). */
  async revoke(teamId: string, userId: string): Promise<void> {
    const affected = new Set<string>();
    for (const c of this.store.all()) {
      const s = c.getState();
      if (s.userId !== userId) continue;
      const meetings: Record<string, string> = {};
      for (const [m, t] of Object.entries(s.meetings)) {
        if (t === teamId) affected.add(m);
        else meetings[m] = t;
      }
      c.setState({ ...s, teams: s.teams.filter((t) => t !== teamId), meetings });
    }
    for (const m of affected) await this.manager.presenceChanged(m);
  }
}
