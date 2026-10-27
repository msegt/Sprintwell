import { DurableObject } from 'cloudflare:workers';
import { MeetingManager, type TimerHost } from '../../server/src/meetings/manager';
import { EMPTY_CONN_STATE, Realtime, type ConnState, type Connection } from '../../server/src/realtime/core';
import { createGitlab } from '../../server/src/gitlab';
import { configFromEnv, log, makeRepo, type Env } from './env';

interface Attachment {
  teamId: string;
  state: ConnState;
}

/**
 * One Durable Object per team. It owns that team's WebSocket connections and
 * live events, so commands for a meeting are always handled in one place.
 *
 * Uses the WebSocket Hibernation API: between messages the object can be
 * evicted from memory without dropping connections. Everything needed after
 * waking up lives in WebSocket attachments, D1, or Durable Object storage
 * (pairing-timer alarms).
 */
export class TeamRoom extends DurableObject<Env> {
  private teamId: string | null = null;
  private realtime: Realtime | null = null;
  private manager: MeetingManager | null = null;
  private wrappers = new WeakMap<WebSocket, Connection>();
  private timers: Record<string, number> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answer keep-alive pings without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    ctx.blockConcurrencyWhile(async () => {
      this.teamId = (await ctx.storage.get<string>('teamId')) ?? null;
      this.timers = (await ctx.storage.get<Record<string, number>>('timers')) ?? {};
    });
  }

  private setup(teamId: string): { realtime: Realtime; manager: MeetingManager } {
    if (this.teamId && this.teamId !== teamId) throw new Error('Team mismatch');
    if (!this.teamId) {
      this.teamId = teamId;
      void this.ctx.storage.put('teamId', teamId);
    }
    if (!this.realtime || !this.manager) {
      const repo = makeRepo(this.env);
      const store = { all: () => this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).map((ws) => this.wrap(ws)) };
      this.realtime = new Realtime(repo, log, store, teamId);
      const timers: TimerHost = {
        set: (meetingId, at) => {
          this.timers[meetingId] = at;
          this.saveTimers();
        },
        clear: (meetingId) => {
          if (!(meetingId in this.timers)) return;
          delete this.timers[meetingId];
          this.saveTimers();
        },
      };
      // Memory is reclaimed by hibernation, so no idle eviction is needed.
      const gitlab = createGitlab(repo, configFromEnv(this.env));
      this.manager = new MeetingManager(repo, this.realtime, { timers, evictAfterMs: null, onEstimate: (team, storyId, actorId) => gitlab.sync.pushEstimate(team, storyId, actorId) });
      this.realtime.manager = this.manager;
    }
    return { realtime: this.realtime, manager: this.manager };
  }

  private saveTimers(): void {
    void this.ctx.storage.put('timers', this.timers);
    const next = Math.min(...Object.values(this.timers));
    if (Number.isFinite(next)) void this.ctx.storage.setAlarm(next);
    else void this.ctx.storage.deleteAlarm();
  }

  private wrap(ws: WebSocket): Connection {
    let conn = this.wrappers.get(ws);
    if (!conn) {
      conn = {
        key: ws,
        getState: () => (ws.deserializeAttachment() as Attachment | null)?.state ?? { ...EMPTY_CONN_STATE },
        setState: (state) => {
          try {
            ws.serializeAttachment({ teamId: this.teamId ?? '', state } satisfies Attachment);
          } catch {
            /* the socket is already closed */
          }
        },
        send: (text) => {
          try {
            ws.send(text);
          } catch {
            /* closed */
          }
        },
        close: (code, reason) => ws.close(code, reason),
      };
      this.wrappers.set(ws, conn);
    }
    return conn;
  }

  private teamFor(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.teamId ?? this.teamId;
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const teamId = request.headers.get('x-team-id');
    if (!teamId) return new Response('Missing team', { status: 400 });
    const { realtime, manager } = this.setup(teamId);

    if (url.pathname === '/ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ teamId, state: { ...EMPTY_CONN_STATE } } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }

    // Control messages from the API Worker (not reachable from the internet).
    const body = request.method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, string>) : {};
    switch (url.pathname) {
      case '/notify':
        realtime.notifyTeam(teamId);
        // Keep the object alive long enough for the debounced broadcast.
        await new Promise((r) => setTimeout(r, 60));
        return new Response('ok');
      case '/revoke':
        await realtime.revoke(teamId, body.userId ?? '');
        realtime.notifyTeam(teamId);
        await new Promise((r) => setTimeout(r, 60));
        return new Response('ok');
      case '/forget-meeting':
        manager.forget(body.meetingId ?? '');
        return new Response('ok');
      case '/forget-team':
        manager.forgetTeam(teamId);
        for (const ws of this.ctx.getWebSockets()) ws.close(4004, 'Team deleted');
        return new Response('ok');
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const teamId = this.teamFor(ws);
    if (!teamId) return ws.close(1011, 'Unknown team');
    const { realtime } = this.setup(teamId);
    await realtime.onMessage(this.wrap(ws), typeof message === 'string' ? message : new TextDecoder().decode(message));
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const teamId = this.teamFor(ws);
    if (teamId) await this.setup(teamId).realtime.onClose(this.wrap(ws));
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    const teamId = this.teamFor(ws);
    if (teamId) await this.setup(teamId).realtime.onClose(this.wrap(ws));
  }

  override async alarm(): Promise<void> {
    if (!this.teamId) return;
    const { manager } = this.setup(this.teamId);
    const now = Date.now();
    const due = Object.entries(this.timers).filter(([, at]) => at <= now + 50);
    for (const [meetingId] of due) {
      delete this.timers[meetingId];
    }
    this.saveTimers();
    // fireTimer re-schedules the next rotation through the TimerHost.
    for (const [meetingId] of due) await manager.fireTimer(meetingId);
  }
}
