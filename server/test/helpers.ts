import { randomBytes } from 'node:crypto';
import type { MeetingView, ServerMessage } from '@sprintwell/shared';
import pg from 'pg';
import WebSocket from 'ws';
import { buildApp, type App } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { startMockGitlab, type MockGitlab } from './mock-gitlab';

process.env.SPRINTWELL_DISABLE_RATE_LIMIT = '1';

const PG_ADMIN = process.env.SPRINTWELL_TEST_PG ?? 'postgres://sprintwell:sprintwell@localhost:5432/sprintwell_test';

export interface TestServer extends Partial<App> {
  base: string;
  dialect: string;
  api<T = any>(method: string, path: string, token?: string | null, body?: unknown): Promise<{ status: number; body: T; text: string }>;
  stop(): Promise<void>;
}

async function apiCall(base: string, method: string, path: string, token?: string | null, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed, text };
}

/**
 * Starts an in-process Node server, or, when SPRINTWELL_TEST_URL is set, points
 * the same tests at an already running server (e.g. `wrangler dev` for Cloudflare).
 */
export async function startServer(overrides: Partial<Config> = {}): Promise<TestServer> {
  const remote = process.env.SPRINTWELL_TEST_URL;
  if (remote) {
    return { base: remote.replace(/\/$/, ''), dialect: 'remote', api: (m, p, t, b) => apiCall(remote.replace(/\/$/, ''), m, p, t, b), stop: async () => undefined };
  }
  let databaseUrl = ':memory:';
  let dropDb: (() => Promise<void>) | null = null;
  if (process.env.SPRINTWELL_TEST_DB === 'postgres') {
    const name = `sw_test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: PG_ADMIN });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    databaseUrl = PG_ADMIN.replace(/\/[^/]+$/, `/${name}`);
    dropDb = async () => {
      const c = new pg.Client({ connectionString: PG_ADMIN });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    };
  }
  const app = await buildApp({ ...loadConfig({}), databaseUrl, webDir: '', ...overrides }, { logger: false });
  await app.app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return {
    ...app,
    base,
    dialect: app.db.dialect,
    api: (method, path, token, body) => apiCall(base, method, path, token, body),
    async stop() {
      await app.app.close();
      if (dropDb) await dropDb();
    },
  };
}

/** Creates a person and returns their token and id. */
export async function person(s: TestServer, name: string): Promise<{ token: string; id: string }> {
  const r = await s.api('POST', '/api/session', null, { displayName: name });
  if (r.status !== 200) throw new Error(`session failed: ${r.text}`);
  return { token: r.body.token, id: r.body.user.id };
}

/** Creates a team with an admin and the given members. */
export async function team(s: TestServer, ...names: string[]) {
  const [adminName, ...others] = names.length ? names : ['Ada'];
  const admin = await person(s, adminName!);
  const created = await s.api('POST', '/api/teams', admin.token, { name: 'Team Rocket', starterCharter: true });
  const teamId: string = created.body.teamId;
  const snap = await s.api('GET', `/api/teams/${teamId}`, admin.token);
  const code: string = snap.body.team.inviteCode;
  const members = [];
  for (const n of others) {
    const p = await person(s, n);
    const j = await s.api('POST', '/api/teams/join', p.token, { code });
    if (j.status !== 200) throw new Error(j.text);
    members.push(p);
  }
  return { teamId, code, admin, members };
}

export class WsClient {
  messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  private nextId = 1;
  views = new Map<string, MeetingView>();

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage;
      if (msg.t === 'meeting') this.views.set(msg.view.id, msg.view);
      this.messages.push(msg);
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(msg);
        }
      }
    });
  }

  static async connect(s: TestServer, token: string, teamId: string): Promise<WsClient> {
    const ws = new WebSocket(s.base.replace('http', 'ws') + `/ws?team=${teamId}`);
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    const c = new WsClient(ws);
    const ready = c.wait((m) => m.t === 'ready');
    ws.send(JSON.stringify({ t: 'auth', token }));
    await ready;
    return c;
  }

  wait(pred: (m: ServerMessage) => boolean, timeoutMs = 3000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async join(meetingId: string): Promise<MeetingView> {
    const p = this.wait((m) => m.t === 'meeting' && m.view.id === meetingId);
    this.send({ t: 'join', meetingId });
    return ((await p) as Extract<ServerMessage, { t: 'meeting' }>).view;
  }

  /** Sends a command and resolves with the ack. */
  async cmd(meetingId: string, cmd: unknown): Promise<{ ok: boolean; error?: string }> {
    const id = this.nextId++;
    const p = this.wait((m) => m.t === 'ack' && m.id === id);
    this.send({ t: 'cmd', meetingId, id, cmd });
    const ack = (await p) as Extract<ServerMessage, { t: 'ack' }>;
    return { ok: ack.ok, error: ack.error };
  }

  /** Sends a command that must succeed and returns this client's latest view afterwards. */
  async ok(meetingId: string, cmd: unknown): Promise<MeetingView> {
    const r = await this.cmd(meetingId, cmd);
    if (!r.ok) throw new Error(`Command failed: ${r.error} (${JSON.stringify(cmd)})`);
    return this.views.get(meetingId)!;
  }

  view(meetingId: string): MeetingView {
    return this.views.get(meetingId)!;
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Story fields that satisfy the starter Definition of Ready, the story format and INVEST. */
export async function readyFields(s: TestServer, teamId: string, token: string) {
  const snap = await s.api('GET', `/api/teams/${teamId}`, token);
  const dor = Object.fromEntries((snap.body.charter as { id: string; kind: string }[]).filter((c) => c.kind === 'dor').map((c) => [c.id, true]));
  return {
    asA: 'student',
    iWant: 'to book a telescope slot',
    soThat: 'I can observe at night',
    acceptanceCriteria: ['Given a free slot, when I book it, then it is mine'],
    invest: { I: true, N: true, V: true, E: true, S: true, T: true },
    dor,
  };
}

/** Port the mock GitLab uses when testing a running server (configure wrangler dev with GITLAB_URL=http://127.0.0.1:4010). */
export const REMOTE_MOCK_GITLAB_PORT = 4010;

/** Starts a mock GitLab and a Sprintwell server configured to use it. */
export async function startWithGitlab(opts: { oauth?: boolean } = {}): Promise<{ s: TestServer; gitlab: MockGitlab }> {
  const remote = !!process.env.SPRINTWELL_TEST_URL;
  const gitlab = await startMockGitlab(remote ? REMOTE_MOCK_GITLAB_PORT : 0);
  const oauth = opts.oauth ?? true;
  const s = await startServer({ gitlab: { url: gitlab.url, clientId: oauth ? gitlab.clientId : '', clientSecret: oauth ? gitlab.clientSecret : '' }, secret: 'test-secret-that-is-long-enough' });
  const stop = s.stop;
  s.stop = async () => {
    await stop();
    await gitlab.close();
  };
  return { s, gitlab };
}

/** Runs the whole "Sign in with GitLab" round trip as `user`, like a browser would. */
export async function gitlabSignIn(s: TestServer, gitlab: MockGitlab, user: { id: number; username: string; name: string }, token: string | null, purpose: 'signin' | 'grant' = 'signin') {
  gitlab.login(user);
  const start = await s.api('POST', '/api/auth/gitlab/start', token, { purpose, returnTo: '/somewhere' });
  if (start.status !== 200) throw new Error(start.text);
  const r = await fetch(start.body.url as string, { redirect: 'manual' });
  const back = new URL(r.headers.get('location') ?? '');
  return s.api('POST', '/api/auth/gitlab/callback', token, { code: back.searchParams.get('code'), state: back.searchParams.get('state'), nonce: start.body.nonce });
}

/** Verifies a GitLab account with a personal access token, as the profile page does. */
export async function gitlabTokenVerify(s: TestServer, gitlab: MockGitlab, user: { id: number; username: string; name: string }, token: string | null) {
  const pat = gitlab.createToken({ user, scopes: ['read_user'] });
  return s.api('POST', '/api/auth/gitlab/token', token, { token: pat });
}
