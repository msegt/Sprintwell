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

export interface MockGitlab {
  url: string;
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
  const state: MockState = { users: new Map(), tokens: new Map(), refresh: new Map(), routes: [], refreshes: 0, tokenLifetime: 7200 };

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

    for (const route of state.routes) if (route(req, url, body, user, res)) return;
    return json(res, 404, { message: '404 Not Found' });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;
  return {
    url,
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
