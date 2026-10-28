import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitlabTokenVerify, person, startWithGitlab, type TestServer } from './helpers';
import type { MockGitlab } from './mock-gitlab';

let s: TestServer;
let gitlab: MockGitlab;
beforeAll(async () => {
  // As at Cardiff: no OAuth application, only access tokens and webhooks.
  ({ s, gitlab } = await startWithGitlab({ oauth: false }));
});
afterAll(async () => {
  await s?.stop();
});

const rnd = () => Math.floor(Math.random() * 1e9);
const glUser = (name: string) => {
  const id = rnd();
  return { id, username: `${name.toLowerCase()}${id}`, name };
};
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

describe('verifying a GitLab account with a personal access token', () => {
  it('links the account to the current profile and revokes the token', async () => {
    const p = await person(s, 'Ada');
    const ada = glUser('Ada');
    const pat = gitlab.createToken({ user: ada, scopes: ['read_user'] });
    const r = await s.api('POST', '/api/auth/gitlab/token', p.token, { token: pat });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token: null, revoked: true, user: { id: p.id, gitlab: { username: ada.username, source: 'token', canUseApi: false } } });
    // Revoked in GitLab, and not stored by Sprintwell.
    expect(gitlab.state.tokens.has(pat)).toBe(false);
    if (s.repo) {
      const row = await s.repo.db.selectFrom('gitlab_accounts').selectAll().where('user_id', '=', p.id).executeTakeFirstOrThrow();
      expect(row.access_token).toBe('');
    }
  });

  it('signs in to the same profile on another device, and creates a profile for a new person', async () => {
    const p = await person(s, 'Grace');
    const grace = glUser('Grace');
    await gitlabTokenVerify(s, gitlab, grace, p.token);
    const again = await gitlabTokenVerify(s, gitlab, grace, null);
    expect(again.body.user.id).toBe(p.id);
    expect(typeof again.body.token).toBe('string');
    const fresh = await gitlabTokenVerify(s, gitlab, glUser('Linus'), null);
    expect(fresh.body.user.displayName).toBe('Linus');
  });

  it('rejects bad tokens and refuses to switch a verified profile to another account', async () => {
    const p = await person(s, 'Barbara');
    expect((await s.api('POST', '/api/auth/gitlab/token', p.token, { token: 'glpat-nonsense-token' })).body.error).toMatch(/did not accept/);
    await gitlabTokenVerify(s, gitlab, glUser('Barbara'), p.token);
    const pid = rnd();
    gitlab.addProject({ id: pid, path_with_namespace: `x/bot-${pid}` });
    const projectToken = gitlab.createToken({ projectId: pid, scopes: ['api'] });
    expect((await s.api('POST', '/api/auth/gitlab/token', null, { token: projectToken })).body.error).toMatch(/project access token/);
    const other = await gitlabTokenVerify(s, gitlab, glUser('Someone'), p.token);
    expect(other.status).toBe(400);
    expect(other.body.error).toMatch(/already verified/);
  });
});

/** A class with one team, a student who joined and a linked GitLab project. */
async function classSetup() {
  const teacher = await person(s, 'Teacher');
  const { classId } = (await s.api('POST', '/api/classes', teacher.token, { name: 'CMT651' })).body;
  await s.api('PATCH', `/api/classes/${classId}`, teacher.token, { settings: { requireGitlab: false } });
  const { teamIds } = (await s.api('POST', `/api/classes/${classId}/teams`, teacher.token, { names: ['Team 1'] })).body;
  const teamId = teamIds[0] as string;
  const code = (await s.api('GET', `/api/teams/${teamId}`, teacher.token)).body.team.inviteCode;
  const student = await person(s, 'Student');
  await s.api('POST', '/api/teams/join', student.token, { code });
  const pid = rnd();
  const path = `cmt651/team-${pid}`;
  const project = gitlab.addProject({ id: pid, path_with_namespace: path });
  const projectToken = gitlab.createToken({ projectId: pid, scopes: ['api'] });
  return { teacher, classId, teamId, student, project, projectToken, web: `${gitlab.url}/${path}` };
}

describe('teaching staff linking students to GitLab usernames', () => {
  it('needs a linked project, then links by username, and gives way to the student’s own proof', async () => {
    const { teacher, classId, teamId, student, web, projectToken } = await classSetup();
    const real = glUser('Student');
    gitlab.state.users.set(real.id, real);
    const assign = (username: string) => s.api('POST', `/api/classes/${classId}/members/${student.id}/gitlab`, teacher.token, { username });
    expect((await assign(real.username)).status).toBe(409);

    await s.api('POST', `/api/teams/${teamId}/gitlab`, student.token, { project: web, token: projectToken });
    expect((await assign('nobody-called-this')).body.error).toMatch(/no user called/);
    expect((await assign(`@${real.username}`)).status).toBe(200);
    const members = (await s.api('GET', `/api/teams/${teamId}`, teacher.token)).body.team.members;
    expect(members[0]).toMatchObject({ gitlabUsername: real.username, gitlabVerified: 'staff' });
    // Students cannot do this, and staff cannot overwrite a student's own proof.
    expect((await s.api('POST', `/api/classes/${classId}/members/${student.id}/gitlab`, student.token, { username: real.username })).status).toBe(404);
    const proof = await gitlabTokenVerify(s, gitlab, real, student.token);
    expect(proof.body.user.gitlab.source).toBe('token');
    expect((await assign(real.username)).body.error).toMatch(/verified their own/);
  });
});

describe('GitLab webhooks', () => {
  it('only accepts the team’s secret, and reads changes from GitLab instead of trusting the payload', async () => {
    const { teamId, student, web, projectToken, project } = await classSetup();
    const me = glUser('Student');
    await gitlabTokenVerify(s, gitlab, me, student.token);
    project.members.push(me.id);
    await s.api('POST', `/api/teams/${teamId}/gitlab`, student.token, { project: web, token: projectToken });
    const hook = (await s.api('GET', `/api/teams/${teamId}/gitlab/webhook`, student.token)).body;
    expect(hook.url).toBe(`${s.base}/api/gitlab/hooks/${teamId}`);
    expect(hook.secret.length).toBeGreaterThan(20);
    // The secret stays the same when asked again.
    expect((await s.api('GET', `/api/teams/${teamId}/gitlab/webhook`, student.token)).body.secret).toBe(hook.secret);

    const send = (secret: string, payload: object) => fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gitlab-token': secret, 'x-gitlab-event': 'Push Hook' }, body: JSON.stringify(payload) });
    expect((await send('wrong-secret', { object_kind: 'push' })).status).toBe(401);

    // A forged payload claims a commit that GitLab does not know about; GitLab's API reports a real one.
    project.events.push({ id: rnd(), action_name: 'pushed to', target_type: null, author_id: me.id, author: me, created_at: at(1), push_data: { commit_count: 1, ref: 'main', ref_type: 'branch', commit_title: 'Real commit' } });
    expect((await send(hook.secret, { object_kind: 'push', commits: [{ message: 'Forged commit' }] })).status).toBe(200);
    const log = (await s.api('GET', `/api/teams/${teamId}/activity?kind=gitlab`, student.token)).body.entries.map((e: { summary: string }) => e.summary);
    expect(log).toContain('pushed 1 commit to main: “Real commit”');
    expect(log.some((x: string) => x.includes('Forged'))).toBe(false);

    // An issue hook imports that issue straight away.
    project.issues.push({ id: rnd(), iid: 42, title: 'Live issue', description: null, state: 'opened', labels: [], weight: null, milestone: null, web_url: `${web}/-/issues/42`, updated_at: at(0) });
    await send(hook.secret, { object_kind: 'issue', object_attributes: { iid: 42, title: 'whatever the payload says' } });
    const snap = (await s.api('GET', `/api/teams/${teamId}`, student.token)).body;
    expect(snap.stories.find((x: { gitlabIid: number }) => x.gitlabIid === 42).title).toBe('Live issue');
    expect(snap.team.gitlab.webhookAt).toBeTruthy();
  });
});
