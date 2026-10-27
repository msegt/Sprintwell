import type { ClientMessage, MeetingView, ServerMessage } from '@sprintwell/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import { MeetingError } from '../meetings/engine';
import type { Broadcaster, MeetingManager } from '../meetings/manager';
import type { Repo } from '../repo';
import { HttpError } from '../util';

interface Conn {
  socket: WebSocket;
  userId: string | null;
  teams: Set<string>;
  /** meetingId -> teamId */
  meetings: Map<string, string>;
  alive: boolean;
  /** Simple token bucket against floods. */
  tokens: number;
  lastRefill: number;
}

const MAX_TOKENS = 40;
const REFILL_PER_SEC = 20;

export class Hub implements Broadcaster {
  private conns = new Set<Conn>();
  private teamSubs = new Map<string, Set<Conn>>();
  private rooms = new Map<string, Set<Conn>>();
  private pendingTeams = new Map<string, NodeJS.Timeout>();
  private heartbeat: NodeJS.Timeout;
  manager!: MeetingManager;

  constructor(
    private readonly repo: Repo,
    private readonly log: FastifyBaseLogger,
  ) {
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) {
          c.socket.terminate();
          continue;
        }
        c.alive = false;
        c.socket.ping();
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const t of this.pendingTeams.values()) clearTimeout(t);
    for (const c of this.conns) c.socket.close(1001, 'Server shutting down');
  }

  accept(socket: WebSocket): void {
    const conn: Conn = { socket, userId: null, teams: new Set(), meetings: new Map(), alive: true, tokens: MAX_TOKENS, lastRefill: Date.now() };
    this.conns.add(conn);
    const authTimer = setTimeout(() => {
      if (!conn.userId) socket.close(4001, 'Authentication required');
    }, 10_000);

    socket.on('pong', () => (conn.alive = true));
    socket.on('close', () => {
      clearTimeout(authTimer);
      this.drop(conn);
    });
    socket.on('error', () => socket.terminate());
    socket.on('message', (data) => {
      conn.alive = true;
      if (!this.take(conn)) {
        this.send(conn, { t: 'error', error: 'Slow down a little.' });
        return;
      }
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      this.handle(conn, msg).catch((err: unknown) => {
        this.log.warn({ err }, 'ws message failed');
      });
    });
  }

  private take(conn: Conn): boolean {
    const t = Date.now();
    conn.tokens = Math.min(MAX_TOKENS, conn.tokens + ((t - conn.lastRefill) / 1000) * REFILL_PER_SEC);
    conn.lastRefill = t;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  private async handle(conn: Conn, msg: ClientMessage): Promise<void> {
    if (msg.t === 'ping') return this.send(conn, { t: 'pong' });
    if (msg.t === 'auth') {
      // A socket keeps one identity for its lifetime; switching would keep old subscriptions alive.
      if (conn.userId) return this.send(conn, { t: 'error', error: 'Already signed in' });
      const user = typeof msg.token === 'string' ? await this.repo.userForToken(msg.token) : null;
      if (!user) {
        conn.socket.close(4001, 'Invalid session');
        return;
      }
      conn.userId = user.id;
      return this.send(conn, { t: 'ready', userId: user.id });
    }
    const userId = conn.userId;
    if (!userId) return this.send(conn, { t: 'error', error: 'Not signed in' });

    switch (msg.t) {
      case 'sub': {
        if (typeof msg.teamId !== 'string' || !(await this.repo.membership(msg.teamId, userId))) {
          return this.send(conn, { t: 'error', error: 'Not a member of that team' });
        }
        conn.teams.add(msg.teamId);
        setAdd(this.teamSubs, msg.teamId, conn);
        return;
      }
      case 'unsub':
        conn.teams.delete(msg.teamId);
        setRemove(this.teamSubs, msg.teamId, conn);
        return;
      case 'join': {
        try {
          const teamId = await this.manager.teamOf(String(msg.meetingId));
          if (!(await this.repo.membership(teamId, userId))) throw new Error('forbidden');
          conn.meetings.set(msg.meetingId, teamId);
          setAdd(this.rooms, msg.meetingId, conn);
          // Send the joiner a view straight away, then tell everyone about the new presence.
          this.send(conn, { t: 'meeting', view: await this.manager.viewFor(msg.meetingId, userId) });
          await this.manager.presenceChanged(msg.meetingId);
        } catch {
          this.send(conn, { t: 'error', error: 'Meeting not found' });
        }
        return;
      }
      case 'leave':
        if (conn.meetings.delete(msg.meetingId)) {
          setRemove(this.rooms, msg.meetingId, conn);
          await this.manager.presenceChanged(msg.meetingId);
        }
        return;
      case 'cmd': {
        if (!conn.meetings.has(msg.meetingId)) {
          return this.send(conn, { t: 'ack', id: msg.id, ok: false, error: 'Join the meeting first.' });
        }
        try {
          await this.manager.command(msg.meetingId, userId, msg.cmd);
          this.send(conn, { t: 'ack', id: msg.id, ok: true });
        } catch (err) {
          const error = err instanceof MeetingError || err instanceof HttpError ? err.message : 'Something went wrong. Please try again.';
          if (!(err instanceof MeetingError || err instanceof HttpError)) this.log.error({ err }, 'meeting command failed');
          this.send(conn, { t: 'ack', id: msg.id, ok: false, error });
        }
        return;
      }
    }
  }

  private drop(conn: Conn): void {
    this.conns.delete(conn);
    for (const teamId of conn.teams) setRemove(this.teamSubs, teamId, conn);
    for (const meetingId of conn.meetings.keys()) {
      setRemove(this.rooms, meetingId, conn);
      void this.manager.presenceChanged(meetingId);
    }
  }

  private send(conn: Conn, msg: ServerMessage): void {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(msg));
  }

  // ------------------------------------------------------------ Broadcaster

  online(meetingId: string): string[] {
    const room = this.rooms.get(meetingId);
    if (!room) return [];
    return [...new Set([...room].map((c) => c.userId).filter((id): id is string => !!id))];
  }

  broadcastMeeting(meetingId: string, view: (userId: string) => MeetingView): void {
    const room = this.rooms.get(meetingId);
    if (!room) return;
    const cache = new Map<string, string>();
    for (const c of room) {
      if (!c.userId) continue;
      let payload = cache.get(c.userId);
      if (!payload) {
        payload = JSON.stringify({ t: 'meeting', view: view(c.userId) } satisfies ServerMessage);
        cache.set(c.userId, payload);
      }
      if (c.socket.readyState === c.socket.OPEN) c.socket.send(payload);
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
        for (const c of this.teamSubs.get(teamId) ?? []) if (c.socket.readyState === c.socket.OPEN) c.socket.send(payload);
      }, 40),
    );
  }

  /** Disconnects a person from a team's live data (after removal or account deletion). */
  revoke(teamId: string, userId: string): void {
    for (const c of this.conns) {
      if (c.userId !== userId) continue;
      c.teams.delete(teamId);
      setRemove(this.teamSubs, teamId, c);
      for (const [meetingId, t] of c.meetings) {
        if (t !== teamId) continue;
        c.meetings.delete(meetingId);
        setRemove(this.rooms, meetingId, c);
        void this.manager.presenceChanged(meetingId);
      }
    }
  }
}

function setAdd<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(value);
}

function setRemove<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}
