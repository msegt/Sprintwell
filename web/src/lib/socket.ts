import type { MeetingView, ServerMessage } from '@sprintwell/shared';
import { getToken } from './api';

type Listener = (msg: ServerMessage) => void;
export type ConnectionState = 'connecting' | 'online' | 'offline';

/**
 * One WebSocket per tab. Reconnects with back-off and restores team
 * subscriptions and meeting rooms after a reconnect.
 */
class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private teams = new Map<string, number>();
  private meetings = new Map<string, number>();
  private pending = new Map<number, { resolve: (v: { ok: boolean; error?: string }) => void; timer: number }>();
  private nextId = 1;
  private retry = 0;
  private ready = false;
  private queue: string[] = [];
  state: ConnectionState = 'offline';
  userId: string | null = null;

  constructor() {
    window.addEventListener('sprintwell:token', () => this.restart());
    window.addEventListener('online', () => this.ensure());
  }

  private setState(s: ConnectionState) {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  onState(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    this.ensure();
    return () => this.listeners.delete(fn);
  }

  private restart() {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
    this.ensure();
  }

  ensure() {
    if (this.ws || !getToken()) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.setState('connecting');
    ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', token: getToken() }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.t === 'ready') {
        this.ready = true;
        this.retry = 0;
        this.userId = msg.userId;
        this.setState('online');
        for (const id of this.teams.keys()) this.raw({ t: 'sub', teamId: id });
        for (const id of this.meetings.keys()) this.raw({ t: 'join', meetingId: id });
        for (const q of this.queue.splice(0)) ws.send(q);
      }
      if (msg.t === 'ack') {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
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
      this.setState('offline');
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'Connection lost. Trying to reconnect…' });
        this.pending.delete(id);
      }
      if (e.code === 4001) return; // invalid session: the app will ask the person to rejoin
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => this.ensure(), delay);
    };
  }

  private raw(msg: unknown) {
    const text = JSON.stringify(msg);
    if (this.ws && this.ready) this.ws.send(text);
    else {
      this.queue.push(text);
      this.ensure();
    }
  }

  subscribeTeam(teamId: string): () => void {
    this.teams.set(teamId, (this.teams.get(teamId) ?? 0) + 1);
    if (this.teams.get(teamId) === 1) this.raw({ t: 'sub', teamId });
    return () => {
      const n = (this.teams.get(teamId) ?? 1) - 1;
      if (n <= 0) {
        this.teams.delete(teamId);
        this.raw({ t: 'unsub', teamId });
      } else this.teams.set(teamId, n);
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

export const socket = new Socket();

export type { MeetingView };
