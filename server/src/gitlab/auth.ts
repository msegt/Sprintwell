import { LIMITS, type UserDTO } from '@sprintwell/shared';
import { gitlabEnabled, type Config } from '../config';
import { SecretBox, pkcePair } from '../crypto';
import type { Repo } from '../repo';
import { HttpError, badRequest, hashToken, newToken, now } from '../util';
import { gitlabApi, tokenRequest, type GitlabUser, type TokenResponse } from './client';

/**
 * Sign in with GitLab (OAuth 2 authorisation code flow with PKCE).
 *
 * - "signin" asks only for `read_user`: enough to know who someone is.
 * - "grant" asks for `api`, needed to import from and write estimates back to
 *   GitLab as that person. People choose this separately, so signing in never
 *   hands Sprintwell write access by surprise.
 */
export type AuthPurpose = 'signin' | 'grant';

const SCOPES: Record<AuthPurpose, string> = { signin: 'read_user', grant: 'api' };
const STATE_TTL_MS = 10 * 60_000;

export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') && value.length <= 300 ? value : '/';
}

export class GitlabAuth {
  private readonly box: SecretBox | null;

  constructor(
    private readonly repo: Repo,
    private readonly config: Config,
  ) {
    this.box = gitlabEnabled(config) ? new SecretBox(config.secret) : null;
  }

  get enabled(): boolean {
    return this.box !== null;
  }

  private need(): SecretBox {
    if (!this.box) throw new HttpError(404, 'GitLab sign-in is not set up on this Sprintwell server.');
    return this.box;
  }

  redirectUri(origin: string): string {
    return `${this.config.publicUrl || origin}/auth/gitlab/callback`;
  }

  /**
   * Returns the GitLab address to send the browser to, and a nonce the browser
   * keeps and sends back with the callback. The nonce stops someone from
   * finishing their own sign-in in another person's browser (by sending them
   * the callback link), which could otherwise link the wrong GitLab account.
   */
  async start(input: { purpose: AuthPurpose; userId: string | null; returnTo: string; origin: string }): Promise<{ url: string; nonce: string }> {
    this.need();
    if (input.purpose === 'grant' && !input.userId) throw new HttpError(401, 'Sign in first.');
    const { verifier, challenge } = pkcePair();
    const state = newToken();
    const nonce = newToken();
    const db = this.repo.db;
    await db.deleteFrom('oauth_states').where('created_at', '<', new Date(Date.now() - STATE_TTL_MS).toISOString()).execute();
    await db
      .insertInto('oauth_states')
      .values({ state_hash: hashToken(state), verifier, purpose: input.purpose, user_id: input.userId, return_to: safeReturnTo(input.returnTo), created_at: now(), nonce_hash: hashToken(nonce) })
      .execute();
    const params = new URLSearchParams({
      client_id: this.config.gitlab.clientId,
      redirect_uri: this.redirectUri(input.origin),
      response_type: 'code',
      state,
      scope: SCOPES[input.purpose],
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return { url: `${this.config.gitlab.url}/oauth/authorize?${params.toString()}`, nonce };
  }

  /**
   * Completes the flow. Signing in links GitLab to the person's current
   * Sprintwell profile if they have one and GitLab is not yet linked elsewhere;
   * otherwise it signs in to the profile already linked to that GitLab account.
   */
  async finish(input: { code: string; state: string; nonce: string; origin: string; currentUserId: string | null }): Promise<{ token: string | null; user: UserDTO; returnTo: string }> {
    const box = this.need();
    const db = this.repo.db;
    const hash = hashToken(input.state);
    const row = await db.selectFrom('oauth_states').selectAll().where('state_hash', '=', hash).executeTakeFirst();
    await db.deleteFrom('oauth_states').where('state_hash', '=', hash).execute();
    if (!row || Date.now() - Date.parse(row.created_at) > STATE_TTL_MS) throw badRequest('That GitLab sign-in link has expired. Please start again.');
    if (!row.nonce_hash || row.nonce_hash !== hashToken(input.nonce)) throw badRequest('This GitLab sign-in was started in a different browser. Please start again from Sprintwell.');
    // Whoever started the sign-in must be the person finishing it.
    if ((row.user_id ?? null) !== (input.currentUserId ?? null)) throw badRequest('You signed in or out while GitLab was open. Please start again.');

    const tokens = await tokenRequest(this.config.gitlab, {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: this.redirectUri(input.origin),
      code_verifier: row.verifier,
    });
    const { data: gl } = await gitlabApi<GitlabUser>(this.config.gitlab, tokens.access_token, '/user', { what: 'read your profile' });
    const gitlabId = String(gl.id);
    const linked = await db.selectFrom('gitlab_accounts').select('user_id').where('gitlab_id', '=', gitlabId).executeTakeFirst();

    let userId: string;
    let token: string | null = null;
    if (row.purpose === 'grant') {
      if (!row.user_id || row.user_id !== input.currentUserId) throw badRequest('Please sign in again before connecting GitLab.');
      if (linked && linked.user_id !== row.user_id) throw badRequest(`The GitLab account @${gl.username} belongs to a different Sprintwell profile. Sign out and sign in with GitLab instead.`);
      const mine = await db.selectFrom('gitlab_accounts').select('gitlab_id').where('user_id', '=', row.user_id).executeTakeFirst();
      if (mine && mine.gitlab_id !== gitlabId) throw badRequest(`You are signed in to GitLab as @${gl.username}, but this profile is linked to a different GitLab account.`);
      userId = row.user_id;
    } else if (linked) {
      userId = linked.user_id;
      if (userId !== input.currentUserId) token = await this.repo.createSession(userId);
    } else if (row.user_id && row.user_id === input.currentUserId && !(await db.selectFrom('gitlab_accounts').select('user_id').where('user_id', '=', input.currentUserId).executeTakeFirst())) {
      // Upgrade the current link-and-name profile: teams and history stay.
      userId = input.currentUserId;
    } else {
      const created = await this.repo.createUser((gl.name || gl.username).slice(0, LIMITS.displayName));
      userId = created.user.id;
      token = created.token;
    }

    await this.store(box, userId, gl, tokens, SCOPES[row.purpose as AuthPurpose] ?? 'read_user');
    const user = await this.repo.userById(userId);
    if (!user) throw new HttpError(404, 'Profile not found');
    return { token, user, returnTo: row.return_to };
  }

  private async store(box: SecretBox, userId: string, gl: GitlabUser, tokens: TokenResponse, requested: string): Promise<void> {
    const ts = now();
    const values = {
      gitlab_id: String(gl.id),
      username: gl.username,
      name: gl.name ?? gl.username,
      scopes: tokens.scope ?? requested,
      access_token: box.seal(tokens.access_token),
      refresh_token: tokens.refresh_token ? box.seal(tokens.refresh_token) : null,
      expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      updated_at: ts,
    };
    const db = this.repo.db;
    const existing = await db.selectFrom('gitlab_accounts').select('scopes').where('user_id', '=', userId).executeTakeFirst();
    if (existing) {
      // Keep wider permission if someone signs in again with the narrower scope.
      const keepApi = existing.scopes.split(/\s+/).includes('api') && !values.scopes.split(/\s+/).includes('api');
      if (keepApi) {
        await db.updateTable('gitlab_accounts').set({ username: values.username, name: values.name, updated_at: ts }).where('user_id', '=', userId).execute();
        return;
      }
      await db.updateTable('gitlab_accounts').set(values).where('user_id', '=', userId).execute();
    } else {
      await db.insertInto('gitlab_accounts').values({ ...values, user_id: userId, created_at: ts }).execute();
    }
  }

  /** A usable access token for the person, refreshed when it is about to expire. */
  async accessToken(userId: string, origin: string, needWrite = false): Promise<string> {
    const box = this.need();
    const db = this.repo.db;
    const acc = await db.selectFrom('gitlab_accounts').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!acc) throw new HttpError(409, 'Connect your GitLab account first (on your profile).');
    if (needWrite && !acc.scopes.split(/\s+/).includes('api')) throw new HttpError(409, 'Allow Sprintwell to access GitLab on your behalf first (on your profile).');
    const access = box.open(acc.access_token);
    const fresh = acc.expires_at ? Date.parse(acc.expires_at) - Date.now() > 60_000 : true;
    if (access && fresh) return access;
    const refresh = acc.refresh_token ? box.open(acc.refresh_token) : null;
    if (!refresh) throw new HttpError(409, 'Your GitLab connection has expired. Connect GitLab again from your profile.');
    const tokens = await tokenRequest(this.config.gitlab, { grant_type: 'refresh_token', refresh_token: refresh, redirect_uri: this.redirectUri(origin) }).catch(() => {
      throw new HttpError(409, 'Your GitLab connection has expired. Connect GitLab again from your profile.');
    });
    await db
      .updateTable('gitlab_accounts')
      .set({
        access_token: box.seal(tokens.access_token),
        refresh_token: tokens.refresh_token ? box.seal(tokens.refresh_token) : acc.refresh_token,
        expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
        updated_at: now(),
      })
      .where('user_id', '=', userId)
      .execute();
    return tokens.access_token;
  }

  async disconnect(userId: string): Promise<void> {
    await this.repo.db.deleteFrom('gitlab_accounts').where('user_id', '=', userId).execute();
  }
}

