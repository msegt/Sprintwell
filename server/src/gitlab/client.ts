import type { GitlabSettings } from '../config';
import { HttpError } from '../util';

/** A GitLab API call failed; the message is safe to show to people. */
export class GitlabError extends HttpError {
  constructor(
    message: string,
    readonly upstreamStatus: number,
  ) {
    super(502, message);
  }
}

const TIMEOUT_MS = 15_000;

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new GitlabError('Sprintwell could not reach GitLab. Please try again in a moment.', 0);
  }
}

function explain(status: number, what: string): string {
  if (status === 401) return 'GitLab did not accept the connection. Please connect GitLab again from your profile.';
  if (status === 403) return `GitLab says you do not have permission to ${what}.`;
  if (status === 404) return `GitLab could not find that (${what}). Check the project address and that you are a member.`;
  if (status === 429) return 'GitLab is rate limiting requests. Please wait a minute and try again.';
  return `GitLab could not ${what} (error ${status}).`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** Exchanges an authorisation code or refresh token at GitLab's OAuth token endpoint. */
export async function tokenRequest(gitlab: GitlabSettings, params: Record<string, string>): Promise<TokenResponse> {
  const res = await request(`${gitlab.url}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: gitlab.clientId, client_secret: gitlab.clientSecret, ...params }).toString(),
  });
  if (!res.ok) throw new GitlabError(res.status === 400 || res.status === 401 ? 'GitLab sign-in expired or was cancelled. Please try again.' : explain(res.status, 'sign you in'), res.status);
  return (await res.json()) as TokenResponse;
}

/** Calls the GitLab REST API (v4) as a person. */
export async function gitlabApi<T>(gitlab: GitlabSettings, token: string, path: string, init: { method?: string; body?: unknown; what?: string } = {}): Promise<{ data: T; headers: Headers }> {
  const res = await request(`${gitlab.url}/api/v4${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new GitlabError(explain(res.status, init.what ?? 'complete the request'), res.status);
  return { data: (await res.json()) as T, headers: res.headers };
}

export interface GitlabUser {
  id: number;
  username: string;
  name: string;
  web_url?: string;
}
