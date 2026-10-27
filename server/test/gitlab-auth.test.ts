import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitlabAuth } from '../src/gitlab/auth';
import { gitlabSignIn, person, startWithGitlab, team, type TestServer } from './helpers';
import type { MockGitlab } from './mock-gitlab';

let s: TestServer;
let gitlab: MockGitlab;
beforeAll(async () => {
  ({ s, gitlab } = await startWithGitlab());
});
afterAll(async () => {
  await s?.stop();
});

let nextId = 100;
const glUser = (name: string) => ({ id: nextId++, username: name.toLowerCase(), name });

describe('Sign in with GitLab', () => {
  it('is advertised in the public config', async () => {
    const cfg = await s.api('GET', '/api/config');
    expect(cfg.body.gitlab).toEqual({ enabled: true, url: gitlab.url });
  });

  it('upgrades a link-and-name profile, keeping its teams, and shows the verified username to the team', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const ada = glUser('Ada');
    const r = await gitlabSignIn(s, gitlab, ada, admin.token);
    expect(r.status).toBe(200);
    expect(r.body.token).toBeNull();
    expect(r.body.returnTo).toBe('/somewhere');
    expect(r.body.user).toMatchObject({ id: admin.id, gitlab: { username: ada.username, canUseApi: false } });
    const snap = await s.api('GET', `/api/teams/${teamId}`, members[0]!.token);
    const byId = Object.fromEntries(snap.body.team.members.map((m: { userId: string; gitlabUsername: string | null }) => [m.userId, m.gitlabUsername]));
    expect(byId[admin.id]).toBe(ada.username);
    expect(byId[members[0]!.id]).toBeNull();

    // On a new device, signing in with the same GitLab account returns the same profile.
    const again = await gitlabSignIn(s, gitlab, ada, null);
    expect(again.body.user.id).toBe(admin.id);
    const me = await s.api('GET', '/api/me', again.body.token);
    expect(me.body.teams.map((t: { id: string }) => t.id)).toContain(teamId);
  });

  it('creates a new profile named after the GitLab account when nobody is signed in', async () => {
    const r = await gitlabSignIn(s, gitlab, glUser('Linus Torvalds'), null);
    expect(r.body.user.displayName).toBe('Linus Torvalds');
    expect(typeof r.body.token).toBe('string');
  });

  it('asks separately for API access, and refuses another person’s GitLab account', async () => {
    const p = await person(s, 'Barbara');
    const barbara = glUser('Barbara');
    await gitlabSignIn(s, gitlab, barbara, p.token);
    const granted = await gitlabSignIn(s, gitlab, barbara, p.token, 'grant');
    expect(granted.body.user.gitlab.canUseApi).toBe(true);
    // Signing in again with the narrower scope keeps API access.
    expect((await gitlabSignIn(s, gitlab, barbara, p.token)).body.user.gitlab.canUseApi).toBe(true);

    const other = await person(s, 'Mallory');
    const steal = await gitlabSignIn(s, gitlab, barbara, other.token, 'grant');
    expect(steal.status).toBe(400);
    expect(steal.body.error).toMatch(/different Sprintwell profile/);
  });

  it('rejects reused or unknown state values', async () => {
    const p = await person(s, 'Eve');
    gitlab.login(glUser('Eve'));
    const start = await s.api('POST', '/api/auth/gitlab/start', p.token, { purpose: 'signin' });
    const back = new URL((await fetch(start.body.url, { redirect: 'manual' })).headers.get('location')!);
    const body = { code: back.searchParams.get('code'), state: back.searchParams.get('state') };
    expect((await s.api('POST', '/api/auth/gitlab/callback', p.token, body)).status).toBe(200);
    expect((await s.api('POST', '/api/auth/gitlab/callback', p.token, body)).status).toBe(400);
    expect((await s.api('POST', '/api/auth/gitlab/callback', p.token, { code: 'x', state: 'nonexistent-state-value' })).status).toBe(400);
  });

  it('only redirects back to paths on this site', async () => {
    const start = await s.api('POST', '/api/auth/gitlab/start', null, { purpose: 'signin', returnTo: 'https://evil.example/' });
    gitlab.login(glUser('Redirect'));
    const back = new URL((await fetch(start.body.url, { redirect: 'manual' })).headers.get('location')!);
    const r = await s.api('POST', '/api/auth/gitlab/callback', null, { code: back.searchParams.get('code'), state: back.searchParams.get('state') });
    expect(r.body.returnTo).toBe('/');
  });

  it('disconnects GitLab on request and when someone erases their profile', async () => {
    const p = await person(s, 'Dora');
    await gitlabSignIn(s, gitlab, glUser('Dora'), p.token);
    await s.api('DELETE', '/api/me/gitlab', p.token);
    expect((await s.api('GET', '/api/me', p.token)).body.user.gitlab).toBeNull();
  });

  it.skipIf(!!process.env.SPRINTWELL_TEST_URL)('stores tokens encrypted and refreshes them before they expire', async () => {
    const p = await person(s, 'Rita');
    await gitlabSignIn(s, gitlab, glUser('Rita'), p.token, 'grant');
    const row = await s.repo!.db.selectFrom('gitlab_accounts').selectAll().where('user_id', '=', p.id).executeTakeFirstOrThrow();
    expect(row.access_token.startsWith('v1.')).toBe(true);
    expect([...gitlab.state.tokens.keys()].some((t) => row.access_token.includes(t))).toBe(false);

    const auth = new GitlabAuth(s.repo!, { ...(await import('../src/config')).loadConfig({}), gitlab: { url: gitlab.url, clientId: gitlab.clientId, clientSecret: gitlab.clientSecret }, secret: 'test-secret-that-is-long-enough' });
    await s.repo!.db.updateTable('gitlab_accounts').set({ expires_at: new Date(Date.now() + 5_000).toISOString() }).where('user_id', '=', p.id).execute();
    const before = gitlab.state.refreshes;
    const token = await auth.accessToken(p.id, s.base, true);
    expect(gitlab.state.refreshes).toBe(before + 1);
    expect(gitlab.state.tokens.has(token)).toBe(true);
  });
});
