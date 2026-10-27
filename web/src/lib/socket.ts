import type { ServerMessage } from '@sprintwell/shared';
import { getToken } from './api';

type Listener = (msg: ServerMessage) => void;
export type ConnectionState = 'connecting' | 'online' | 'offline';

const PING = '{"t":"ping"}';

/**
 * One WebSocket per team (on Cloudflare each team's live data lives in its own
 * Durable Object). Reconnects with back-off, restores subscriptions and
 * meeting rooms, and sends keep-alive pings.
 */
class TeamSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private subscribed = 0;
  private meetings = new Map<string, number>();
  private pending = new Map<number, { resolve: (v: { ok: boolean; error?: string }) => void; timer: number }>();
  private nextId = 1;
  private retry = 0;
  private ready = false;
  private queue: string[] = [];
  private pingTimer: number | undefined;
  private pongDeadline: number | undefined;
  private closedForGood = false;
  state: ConnectionState = 'offline';

  constructor(
    readonly teamId: string,
    private readonly onStateChange: () => void,
  ) {}

  private setState(s: ConnectionState) {
    this.state = s;
    this.onStateChange();
  }

  get idle(): boolean {
    return this.subscribed === 0 && this.meetings.size === 0 && this.listeners.size === 0;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    this.ensure();
    return () => this.listeners.delete(fn);
  }

  restart() {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
    if (!this.idle) this.ensure();
  }

  dispose() {
    this.closedForGood = true;
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  ensure() {
    if (this.ws || this.closedForGood || !getToken()) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?team=${encodeURIComponent(this.teamId)}`);
    this.ws = ws;
    this.setState('connecting');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: getToken() }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.t === 'pong') {
        window.clearTimeout(this.pongDeadline);
        return;
      }
      if (msg.t === 'ready') {
        this.ready = true;
        this.retry = 0;
        this.setState('online');
        if (this.subscribed > 0) this.raw({ t: 'sub', teamId: this.teamId });
        for (const id of this.meetings.keys()) this.raw({ t: 'join', meetingId: id });
        for (const q of this.queue.splice(0)) ws.send(q);
        this.startPings(ws);
      }
      if (msg.t === 'ack') {
        const p = this.pending.get(msg.id);
        if (p) {
          window.clearTimeout(p.timer);
          this.pending.delete(msg.id);
          p.resolve({ ok: msg.ok, error: msg.error });
        }
      }
      for (const l of this.listeners) l(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      window.clearInterval(this.pingTimer);
      window.clearTimeout(this.pongDeadline);
      this.setState('offline');
      for (const [id, p] of this.pending) {
        window.clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'Connection lost. Trying to reconnect…' });
        this.pending.delete(id);
      }
      if (e.code === 4001 || e.code === 4004 || this.closedForGood) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => {
        if (!this.idle) this.ensure();
      }, delay);
    };
  }

  /** Keep-alive: detects dead connections (e.g. after a laptop sleeps). */
  private startPings(ws: WebSocket) {
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(PING);
      window.clearTimeout(this.pongDeadline);
      this.pongDeadline = window.setTimeout(() => ws.close(), 10_000);
    }, 25_000);
  }

  private raw(msg: unknown) {
    const text = JSON.stringify(msg);
    if (this.ws && this.ready) this.ws.send(text);
    else {
      this.queue.push(text);
      this.ensure();
    }
  }

  subscribe(): () => void {
    this.subscribed += 1;
    if (this.subscribed === 1) this.raw({ t: 'sub', teamId: this.teamId });
    return () => {
      this.subscribed = Math.max(0, this.subscribed - 1);
      if (this.subscribed === 0) this.raw({ t: 'unsub', teamId: this.teamId });
    };
  }

  joinMeeting(meetingId: string): () => void {
    this.meetings.set(meetingId, (this.meetings.get(meetingId) ?? 0) + 1);
    if (this.meetings.get(meetingId) === 1) this.raw({ t: 'join', meetingId });
    return () => {
      const n = (this.meetings.get(meetingId) ?? 1) - 1;
      if (n <= 0) {
        this.meetings.delete(meetingId);
        this.raw({ t: 'leave', meetingId });
      } else this.meetings.set(meetingId, n);
    };
  }

  command(meetingId: string, cmd: unknown): Promise<{ ok: boolean; error?: string }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'No response from the server. Please try again.' });
      }, 10_000);
      this.pending.set(id, { resolve, timer });
      this.raw({ t: 'cmd', meetingId, id, cmd });
    });
  }
}

class SocketPool {
  private sockets = new Map<string, TeamSocket>();
  private stateListeners = new Set<(s: ConnectionState) => void>();

  constructor() {
    window.addEventListener('sprintwell:token', () => {
      for (const s of this.sockets.values()) s.restart();
    });
    window.addEventListener('online', () => {
      for (const s of this.sockets.values()) if (!s.idle) s.ensure();
    });
    // Close sockets for teams nobody is looking at any more.
    window.setInterval(() => {
      for (const [id, s] of this.sockets) {
        if (s.idle) {
          s.dispose();
          this.sockets.delete(id);
          this.emit();
        }
      }
    }, 30_000);
  }

  team(teamId: string): TeamSocket {
    let s = this.sockets.get(teamId);
    if (!s) {
      s = new TeamSocket(teamId, () => this.emit());
      this.sockets.set(teamId, s);
    }
    return s;
  }

  /** "offline" if any active team connection is down. */
  get state(): ConnectionState {
    const active = [...this.sockets.values()].filter((s) => !s.idle);
    if (active.some((s) => s.state === 'offline')) return 'offline';
    if (active.some((s) => s.state === 'connecting')) return 'connecting';
    return 'online';
  }

  onState(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private emit() {
    const s = this.state;
    for (const l of this.stateListeners) l(s);
  }
}

export const sockets = new SocketPool();
