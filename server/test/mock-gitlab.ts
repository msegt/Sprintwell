/**
 * A small in-memory stand-in for a GitLab instance, for tests only. It
 * implements just enough of GitLab's OAuth and REST API (v4) for Sprintwell.
 * Run on its own with: npx tsx server/test/mock-gitlab.ts [port]
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface MockUser {
  id: number;
  username: string;
  name: string;
}

interface Grant {
  user: MockUser;
  challenge: string;
  redirectUri: string;
  scope: string;
}

export interface MockIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  labels: string[];
  weight?: number | null;
  milestone: { id: number } | null;
  web_url: string;
  updated_at: string;
}

export interface MockProject {
  id: number;
  path_with_namespace: string;
  web_url: string;
  /** GitLab user ids of project members. */
  members: number[];
  /** False imitates the free edition, which ignores issue weights. */
  weights: boolean;
  issues: MockIssue[];
  milestones: { id: number; title: string; description: string | null; state: 'active' | 'closed'; start_date: string | null; due_date: string | null }[];
  events: Record<string, unknown>[];
}

export interface MockGitlab {
  url: string;
  /** Adds (or replaces) a project; returns it so tests can change issues and events. */
  addProject(p: Partial<MockProject> & { id: number; path_with_namespace: string }): MockProject;
  clientId: string;
  clientSecret: string;
  /** Who is "signed in to GitLab" in the browser; the next authorisation is approved as them. */
  login(user: MockUser): void;
  state: MockState;
  close(): Promise<void>;
}

export interface MockState {
  users: Map<number, MockUser>;
  tokens: Map<string, { user: MockUser; scope: string; expires: number }>;
  refresh: Map<string, { user: MockUser; scope: string }>;
  /** Extra routes registered by tests (e.g. projects and issues for sync). */
  routes: ((req: IncomingMessage, url: URL, body: string, user: MockUser | null, res: ServerResponse) => boolean)[];
  projects: Map<number, MockProject>;
  /** Requests made to the API, for assertions (method and path). */
  calls: string[];
  /** Number of token refreshes, for assertions. */
  refreshes: number;
  /** Seconds an access token stays valid. */
  tokenLifetime: number;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

export async function startMockGitlab(port = 0): Promise<MockGitlab> {
  const clientId = 'mock-client-id';
  const clientSecret = 'mock-client-secret';
  let current: MockUser | null = null;
  const grants = new Map<string, Grant>();
  const state: MockState = { users: new Map(), tokens: new Map(), refresh: new Map(), routes: [], refreshes: 0, tokenLifetime: 7200, projects: new Map(), calls: [] };
  let base = '';
  const addProject = (p: Partial<MockProject> & { id: number; path_with_namespace: string }): MockProject => {
    const project: MockProject = { web_url: `${base}/${p.path_with_namespace}`, members: [], weights: true, issues: [], milestones: [], events: [], ...p };
    state.projects.set(project.id, project);
    return project;
  };
  const findProject = (key: string) => {
    const decoded = decodeURIComponent(key);
    return /^\d+$/.test(decoded) ? state.projects.get(Number(decoded)) : [...state.projects.values()].find((p) => p.path_with_namespace === decoded);
  };
  const page = <T,>(res: ServerResponse, url: URL, items: T[]) => {
    const per = Number(url.searchParams.get('per_page') ?? 20);
    const n = Number(url.searchParams.get('page') ?? 1);
    const slice = items.slice((n - 1) * per, n * per);
    res.writeHead(200, { 'content-type': 'application/json', ...(n * per < items.length ? { 'x-next-page': String(n + 1) } : {}) });
    res.end(JSON.stringify(slice));
  };

  const issue = (user: MockUser, scope: string) => {
    const access = randomBytes(16).toString('hex');
    const refresh = randomBytes(16).toString('hex');
    state.tokens.set(access, { user, scope, expires: Date.now() + state.tokenLifetime * 1000 });
    state.refresh.set(refresh, { user, scope });
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: state.tokenLifetime, scope, created_at: Math.floor(Date.now() / 1000) };
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let body = '';
    for await (const chunk of req) body += chunk;

    if (url.pathname === '/__mock/health') return json(res, 200, { ok: true });
    if (url.pathname === '/__mock/project' && req.method === 'POST') return json(res, 200, addProject(JSON.parse(body)));
    if (url.pathname.startsWith('/__mock/project/') && req.method === 'GET') return json(res, 200, state.projects.get(Number(url.pathname.split('/').pop())) ?? null);
    if (url.pathname === '/__mock/login' && req.method === 'POST') {
      const u = JSON.parse(body) as MockUser;
      state.users.set(u.id, u);
      current = u;
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/oauth/authorize') {
      const redirect = url.searchParams.get('redirect_uri') ?? '';
      if (url.searchParams.get('client_id') !== clientId) return json(res, 400, { error: 'invalid_client' });
      if (url.searchParams.get('code_challenge_method') !== 'S256' || !url.searchParams.get('code_challenge')) return json(res, 400, { error: 'pkce_required' });
      if (!current) return json(res, 401, { error: 'not signed in to mock GitLab' });
      const code = randomBytes(12).toString('hex');
      grants.set(code, { user: current, challenge: url.searchParams.get('code_challenge')!, redirectUri: redirect, scope: url.searchParams.get('scope') ?? 'read_user' });
      const target = new URL(redirect);
      target.searchParams.set('code', code);
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: target.toString() });
      return res.end();
    }

    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      const p = new URLSearchParams(body);
      if (p.get('client_id') !== clientId || p.get('client_secret') !== clientSecret) return json(res, 401, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        const grant = grants.get(p.get('code') ?? '');
        grants.delete(p.get('code') ?? '');
        if (!grant) return json(res, 400, { error: 'invalid_grant' });
        if (grant.redirectUri !== p.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant', detail: 'redirect_uri' });
        const challenge = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url');
        if (challenge !== grant.challenge) return json(res, 400, { error: 'invalid_grant', detail: 'pkce' });
        return json(res, 200, issue(grant.user, grant.scope));
      }
      if (p.get('grant_type') === 'refresh_token') {
        const r = state.refresh.get(p.get('refresh_token') ?? '');
        state.refresh.delete(p.get('refresh_token') ?? '');
        if (!r) return json(res, 400, { error: 'invalid_grant' });
        state.refreshes++;
        return json(res, 200, issue(r.user, r.scope));
      }
      return json(res, 400, { error: 'unsupported_grant_type' });
    }

    let user: MockUser | null = null;
    const auth = req.headers.authorization ?? '';
    if (auth.startsWith('Bearer ')) {
      const t = state.tokens.get(auth.slice(7));
      if (t && t.expires > Date.now()) user = t.user;
    }
    if (url.pathname.startsWith('/api/v4/') && !user) return json(res, 401, { message: '401 Unauthorized' });
    if (url.pathname === '/api/v4/user') return json(res, 200, { ...user, web_url: `http://gitlab.test/${user!.username}` });

    if (url.pathname.startsWith('/api/v4/')) state.calls.push(`${req.method} ${url.pathname}`);
    const m = /^\/api\/v4\/projects\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (m) {
      const project = findProject(m[1]!);
      const rest = m[2] ?? '';
      const memberOk = project && project.members.includes(user!.id);
      if (!project || !memberOk) return json(res, 404, { message: '404 Project Not Found' });
      if (rest === '') return json(res, 200, { id: project.id, path_with_namespace: project.path_with_namespace, web_url: project.web_url });
      const mem = /^\/members\/all\/(\d+)$/.exec(rest);
      if (mem) return project.members.includes(Number(mem[1])) ? json(res, 200, { id: Number(mem[1]), access_level: 30 }) : json(res, 404, { message: '404 Not found' });
      if (rest === '/milestones') return page(res, url, project.milestones);
      if (rest === '/issues') {
        const after = url.searchParams.get('updated_after');
        const list = project.issues.filter((i) => !after || i.updated_at > after).sort((a, b) => a.updated_at.localeCompare(b.updated_at));
        return page(res, url, list.map((i) => (project.weights ? i : { ...i, weight: undefined })));
      }
      if (rest === '/events') {
        const after = url.searchParams.get('after');
        return page(res, url, project.events.filter((e) => !after || String(e.created_at).slice(0, 10) > after));
      }
      const iss = /^\/issues\/(\d+)$/.exec(rest);
      if (iss) {
        const issue = project.issues.find((i) => i.iid === Number(iss[1]));
        if (!issue) return json(res, 404, { message: '404 Not found' });
        if (req.method === 'PUT') {
          const b = JSON.parse(body || '{}') as { weight?: number | null; add_labels?: string; remove_labels?: string };
          if ('weight' in b && project.weights) issue.weight = b.weight ?? null;
          if (b.remove_labels) issue.labels = issue.labels.filter((l) => !b.remove_labels!.split(',').includes(l));
          if (b.add_labels) issue.labels = [...new Set([...issue.labels, ...b.add_labels.split(',')])];
          issue.updated_at = new Date().toISOString();
        }
        return json(res, 200, project.weights ? issue : { ...issue, weight: undefined });
      }
    }

    for (const route of state.routes) if (route(req, url, body, user, res)) return;
    return json(res, 404, { message: '404 Not Found' });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;
  base = url;
  return {
    url,
    addProject,
    clientId,
    clientSecret,
    login(u) {
      state.users.set(u.id, u);
      current = u;
    },
    state,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const port = Number(process.argv[2] ?? 4010);
  const mock = await startMockGitlab(port);
  console.log(`Mock GitLab on ${mock.url} (client id ${mock.clientId}, secret ${mock.clientSecret})`);
}
