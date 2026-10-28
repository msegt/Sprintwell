import type { StoryDTO } from '@sprintwell/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gitlabTokenVerify, person, sleep, startWithGitlab, WsClient, type TestServer } from './helpers';
import type { MockGitlab, MockIssue } from './mock-gitlab';

let s: TestServer;
let gitlab: MockGitlab;
const clients: WsClient[] = [];
beforeAll(async () => {
  // As at Cardiff: no OAuth application, only access tokens and webhooks.
  ({ s, gitlab } = await startWithGitlab({ oauth: false }));
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
afterAll(async () => {
  await s?.stop();
});

// Random ids keep the tests repeatable against a server whose database persists (e.g. wrangler dev).
let seq = Math.floor(Math.random() * 1e6);
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** A team of two GitLab-verified people and a GitLab project, linked with a project access token. */
async function setup(opts: { weights?: boolean; link?: boolean; scopes?: string[] } = {}) {
  const n = seq++;
  const adaGl = { id: n * 10, username: `ada${n}`, name: 'Ada' };
  const graceGl = { id: n * 10 + 1, username: `grace${n}`, name: 'Grace' };
  const ada = await person(s, 'Ada');
  await gitlabTokenVerify(s, gitlab, adaGl, ada.token);
  const grace = await person(s, 'Grace');
  await gitlabTokenVerify(s, gitlab, graceGl, grace.token);
  const { teamId } = (await s.api('POST', '/api/teams', ada.token, { name: `Sync team ${n}` })).body;
  const code = (await s.api('GET', `/api/teams/${teamId}`, ada.token)).body.team.inviteCode;
  await s.api('POST', '/api/teams/join', grace.token, { code });

  const path = `cmt651/team-${n}`;
  const web = `${gitlab.url}/${path}`;
  const issue = (iid: number, over: Partial<MockIssue>): MockIssue => ({ id: n * 1000 + iid, iid, title: `Issue ${iid}`, description: null, state: 'opened', labels: [], weight: null, milestone: null, web_url: `${web}/-/issues/${iid}`, updated_at: at(60), ...over });
  const project = gitlab.addProject({
    id: 500 + n,
    path_with_namespace: path,
    members: [adaGl.id, graceGl.id],
    weights: opts.weights ?? true,
    milestones: [{ id: 70 + n, title: 'Sprint 1', description: 'Book telescope slots online', state: 'active', start_date: '2026-11-02', due_date: '2026-11-13' }],
    issues: [
      issue(1, {
        title: 'Book a slot',
        description: 'As a visiting astronomer, I want to book a telescope slot so that I can observe at night.\n\n## Acceptance criteria\n- [ ] Given a free slot, when I book it, then it is mine',
        weight: opts.weights === false ? null : 3,
        labels: opts.weights === false ? ['points::3'] : [],
        milestone: { id: 70 + n },
      }),
      issue(2, { title: 'Crash on login', labels: ['bug'] }),
      issue(3, { title: 'Old finished work', state: 'closed' }),
    ],
    events: [
      { id: n * 100 + 1, action_name: 'pushed to', target_type: null, author_id: graceGl.id, author: graceGl, created_at: at(30), push_data: { commit_count: 2, ref: '1-book-a-slot', ref_type: 'branch', commit_title: 'Add booking form' } },
      { id: n * 100 + 2, action_name: 'opened', target_type: 'MergeRequest', target_iid: 4, target_title: 'Resolve "Book a slot"', author_id: adaGl.id, author: adaGl, created_at: at(25) },
      { id: n * 100 + 3, action_name: 'approved', target_type: 'MergeRequest', target_iid: 4, target_title: 'Resolve "Book a slot"', author_id: graceGl.id, author: graceGl, created_at: at(20) },
      { id: n * 100 + 4, action_name: 'commented on', target_type: 'DiffNote', target_title: 'Resolve "Book a slot"', author_id: graceGl.id, author: graceGl, created_at: at(19), note: { noteable_type: 'MergeRequest', noteable_iid: 4, body: 'Looks good' } },
      { id: n * 100 + 5, action_name: 'closed', target_type: 'Issue', target_iid: 9, target_title: 'Something else', author_id: 99, author: { id: 99, username: 'bob', name: 'Bob' }, created_at: at(10) },
    ],
  });
  const projectToken = gitlab.createToken({ projectId: project.id, scopes: opts.scopes ?? ['api'], expiresAt: '2027-06-30' });
  if (opts.link !== false) {
    const r = await s.api('POST', `/api/teams/${teamId}/gitlab`, ada.token, { project: web, token: projectToken });
    if (r.status !== 200) throw new Error(r.text);
  }
  return { ada, grace, teamId, project, path, web, projectToken };
}

const stories = async (teamId: string, token: string): Promise<StoryDTO[]> => (await s.api('GET', `/api/teams/${teamId}`, token)).body.stories;

describe('without an OAuth application', () => {
  it('reports token-only GitLab in the config and refuses OAuth sign-in', async () => {
    expect((await s.api('GET', '/api/config')).body.gitlab).toEqual({ enabled: true, url: gitlab.url, oauth: false });
    expect((await s.api('POST', '/api/auth/gitlab/start', null, { purpose: 'signin' })).status).toBe(404);
  });
});

describe('GitLab project sync', () => {
  it('links a project with a project access token, and checks the token', async () => {
    const { ada, teamId, web, projectToken } = await setup({ link: false });
    const other = await setup({ link: false });
    const tryLink = (body: object) => s.api('POST', `/api/teams/${teamId}/gitlab`, ada.token, body);
    expect((await tryLink({ project: web })).body.error).toMatch(/project access token/);
    expect((await tryLink({ project: web, token: 'glpat-not-a-real-token' })).body.error).toMatch(/did not accept/);
    expect((await tryLink({ project: web, token: other.projectToken })).body.error).toMatch(/cannot see this project/);
    expect((await tryLink({ project: 'https://elsewhere.example/group/project', token: projectToken })).status).toBe(400);
    const linked = await tryLink({ project: `${web}/-/boards`, token: projectToken });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ webUrl: web, access: 'project-token', canWrite: true, tokenExpiresAt: '2027-06-30' });
    // The token never leaves the server.
    expect(JSON.stringify((await s.api('GET', `/api/teams/${teamId}`, ada.token)).body)).not.toContain(projectToken);
  });

  it('works read-only with a read_api token', async () => {
    const { ada, teamId } = await setup({ scopes: ['read_api'] });
    expect((await s.api('GET', `/api/teams/${teamId}`, ada.token)).body.team.gitlab.canWrite).toBe(false);
    await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    const st = (await stories(teamId, ada.token)).find((x) => x.gitlabIid === 1)!;
    const r = await s.api('PATCH', `/api/teams/${teamId}/stories/${st.id}`, ada.token, { estimate: '5' });
    expect(r.status).toBe(200);
    expect(r.body.gitlabError).toMatch(/can only read/);
  });

  it('imports issues and milestones, keeps the Ready gate, and logs merge requests, reviews and commits', async () => {
    const { ada, grace, teamId, web } = await setup();
    const r = await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, grace.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ issuesCreated: 2, sprintsCreated: 1, partial: false });

    const list = await stories(teamId, ada.token);
    const book = list.find((x) => x.title === 'Book a slot')!;
    expect(book).toMatchObject({ kind: 'story', asA: 'visiting astronomer', iWant: 'to book a telescope slot', soThat: 'I can observe at night', estimate: '3', gitlabIid: 1, sprintId: null, externalUrl: `${web}/-/issues/1` });
    expect(book.acceptanceCriteria).toEqual(['Given a free slot, when I book it, then it is mine']);
    expect(list.find((x) => x.title === 'Crash on login')!.kind).toBe('bug');
    expect(list.some((x) => x.title === 'Old finished work')).toBe(false);
    const snap = (await s.api('GET', `/api/teams/${teamId}`, ada.token)).body;
    expect(snap.sprints[0]).toMatchObject({ name: 'Sprint 1', startDate: '2026-11-02', endDate: '2026-11-13' });

    const log = (await s.api('GET', `/api/teams/${teamId}/activity?kind=gitlab`, ada.token)).body;
    const lines = log.entries.map((e: { userId: string | null; summary: string }) => `${e.userId ? log.names[e.userId] : '-'}: ${e.summary}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Grace: pushed 2 commits to 1-book-a-slot: “Add booking form”',
        'Ada: opened merge request !4 “Resolve "Book a slot"”',
        'Grace: approved merge request !4 “Resolve "Book a slot"”',
        'Grace: commented on merge request !4 “Resolve "Book a slot"”',
        '-: @bob closed issue #9 “Something else”',
      ]),
    );

    // Syncing again imports nothing twice.
    const again = await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    expect(again.body).toMatchObject({ issuesCreated: 0, sprintsCreated: 0, events: 0 });
    expect((await stories(teamId, ada.token)).length).toBe(2);
  });

  it('takes newer changes from GitLab and closes finished items', async () => {
    const { ada, teamId, web, project } = await setup();
    await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    await sleep(5);
    const issue = project.issues.find((i) => i.iid === 2)!;
    Object.assign(issue, { title: 'Crash when logging in', state: 'closed', updated_at: new Date().toISOString() });
    const r = await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    expect(r.body.issuesUpdated).toBe(1);
    const st = (await stories(teamId, ada.token)).find((x) => x.gitlabIid === 2)!;
    expect(st).toMatchObject({ title: 'Crash when logging in', status: 'done' });
  });

  it('writes estimates back as the issue weight', async () => {
    const { ada, teamId, web, project } = await setup();
    await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    const st = (await stories(teamId, ada.token)).find((x) => x.gitlabIid === 1)!;
    const r = await s.api('PATCH', `/api/teams/${teamId}/stories/${st.id}`, ada.token, { estimate: '5' });
    expect(r.body.gitlabError).toBeUndefined();
    expect(project.issues.find((i) => i.iid === 1)!.weight).toBe(5);
    expect((await s.api('GET', `/api/teams/${teamId}`, ada.token)).body.team.gitlab.estimateField).toBe('weight');
    // Nothing changed since, so the next sync does not pull it back or push it again.
    const again = await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    expect(again.body).toMatchObject({ estimatesPushed: 0, issuesUpdated: 0 });
    expect((await stories(teamId, ada.token)).find((x) => x.id === st.id)!.estimate).toBe('5');
  });

  it('falls back to a points label where GitLab has no weights, replacing the old label', async () => {
    const { ada, teamId, web, project } = await setup({ weights: false });
    await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    const st = (await stories(teamId, ada.token)).find((x) => x.gitlabIid === 1)!;
    expect(st.estimate).toBe('3');
    await s.api('PATCH', `/api/teams/${teamId}/stories/${st.id}`, ada.token, { estimate: '8' });
    expect(project.issues.find((i) => i.iid === 1)!.labels).toEqual(['points::8']);
    expect((await s.api('GET', `/api/teams/${teamId}`, ada.token)).body.team.gitlab.estimateField).toBe('label');
    await s.api('PATCH', `/api/teams/${teamId}/stories/${st.id}`, ada.token, { estimate: '13' });
    expect(project.issues.find((i) => i.iid === 1)!.labels).toEqual(['points::13']);
  });

  it('writes the Planning Poker result to GitLab without anyone retyping it', async () => {
    const { ada, grace, teamId, web, project } = await setup();
    await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    const st = (await stories(teamId, ada.token)).find((x) => x.gitlabIid === 2)!;
    const { meetingId } = (await s.api('POST', `/api/teams/${teamId}/meetings`, ada.token, { kind: 'poker', options: { storyIds: [st.id] } })).body;
    const a = await WsClient.connect(s, ada.token, teamId);
    const g = await WsClient.connect(s, grace.token, teamId);
    clients.push(a, g);
    a.send({ t: 'join', meetingId });
    g.send({ t: 'join', meetingId });
    await sleep(100);
    await a.cmd(meetingId, { type: 'vote', value: '2' });
    await g.cmd(meetingId, { type: 'vote', value: '2' });
    await a.cmd(meetingId, { type: 'reveal' });
    expect((await a.cmd(meetingId, { type: 'finalise', value: '2' })).ok).toBe(true);
    for (let i = 0; i < 50 && project.issues.find((x) => x.iid === 2)!.weight !== 2; i++) await sleep(20);
    expect(project.issues.find((x) => x.iid === 2)!.weight).toBe(2);
  });

  it('continues where it stopped when a project has more issues than one sync reads', async () => {
    const { ada, teamId, web, project } = await setup();
    const sameTime = at(30);
    for (let iid = 10; iid < 260; iid++) {
      project.issues.push({ id: project.id * 10_000 + iid, iid, title: `Bulk ${iid}`, description: null, state: 'opened', labels: [], weight: null, milestone: null, web_url: `${web}/-/issues/${iid}`, updated_at: sameTime });
    }
    const first = (await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token)).body;
    expect(first.partial).toBe(true);
    let total = first.issuesCreated;
    for (let i = 0; i < 4 && total < 252; i++) total += (await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token)).body.issuesCreated;
    expect(total).toBe(252);
    expect((await stories(teamId, ada.token)).length).toBe(252);
  });

  it('lets anyone in the team sync with the team’s token, and stops when the token expires', async () => {
    const { ada, teamId, web, project } = await setup();
    const linus = await person(s, 'Linus');
    const code = (await s.api('GET', `/api/teams/${teamId}`, ada.token)).body.team.inviteCode;
    await s.api('POST', '/api/teams/join', linus.token, { code });
    expect((await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, linus.token)).status).toBe(200);
    const expired = gitlab.createToken({ projectId: project.id, scopes: ['api'], expiresAt: '2020-01-01' });
    expect((await s.api('POST', `/api/teams/${teamId}/gitlab`, ada.token, { project: web, token: expired })).status).toBe(200);
    const r = await s.api('POST', `/api/teams/${teamId}/gitlab/sync`, ada.token);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/expired/);
  });

});
