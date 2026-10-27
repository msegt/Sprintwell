import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person, startServer, team, type TestServer } from './helpers';

let s: TestServer;
beforeAll(async () => {
  s = await startServer();
});
afterAll(async () => {
  await s?.stop();
});

describe('identity and teams', () => {
  it('creates a team with a starter charter and lets people join by invite code', async () => {
    const { teamId, admin, members, code } = await team(s, 'Ada', 'Grace');
    const snap = await s.api('GET', `/api/teams/${teamId}`, members[0]!.token);
    expect(snap.status).toBe(200);
    expect(snap.body.team.members.map((m: any) => m.displayName)).toEqual(['Ada', 'Grace']);
    expect(snap.body.team.myRole).toBe('member');
    expect(snap.body.charter.filter((c: any) => c.kind === 'dor').length).toBeGreaterThan(3);
    const preview = await s.api('GET', `/api/invites/${code}`);
    expect(preview.body).toEqual({ teamName: 'Team Rocket', memberCount: 2 });
    const me = await s.api('GET', '/api/me', admin.token);
    expect(me.body.teams[0].role).toBe('admin');
  });

  it('hides teams from non-members and rejects anonymous requests', async () => {
    const { teamId } = await team(s, 'Ada');
    const outsider = await person(s, 'Eve');
    expect((await s.api('GET', `/api/teams/${teamId}`, outsider.token)).status).toBe(404);
    expect((await s.api('GET', `/api/teams/${teamId}`)).status).toBe(401);
    expect((await s.api('GET', `/api/teams/${teamId}`, 'not-a-token')).status).toBe(401);
  });

  it('rejects invalid invite codes and validates input', async () => {
    const p = await person(s, 'Eve');
    expect((await s.api('POST', '/api/teams/join', p.token, { code: 'nonexistent' })).status).toBe(404);
    expect((await s.api('POST', '/api/session', null, { displayName: '' })).status).toBe(400);
    expect((await s.api('POST', '/api/session', null, { displayName: 'x'.repeat(41) })).status).toBe(400);
  });

  it('restricts admin actions and protects the last admin', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const grace = members[0]!;
    expect((await s.api('PATCH', `/api/teams/${teamId}`, grace.token, { name: 'Hijacked' })).status).toBe(403);
    expect((await s.api('PATCH', `/api/teams/${teamId}/members/${admin.id}`, admin.token, { role: 'member' })).status).toBe(403);
    expect((await s.api('PATCH', `/api/teams/${teamId}/members/${grace.id}`, admin.token, { role: 'admin' })).status).toBe(200);
    expect((await s.api('PATCH', `/api/teams/${teamId}/members/${admin.id}`, admin.token, { role: 'member' })).status).toBe(200);
  });

  it('promotes the longest-standing member when the last admin leaves', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace', 'Linus');
    expect((await s.api('DELETE', `/api/teams/${teamId}/members/${admin.id}`, admin.token)).status).toBe(200);
    const snap = await s.api('GET', `/api/teams/${teamId}`, members[0]!.token);
    expect(snap.body.team.members.find((m: any) => m.userId === members[0]!.id).role).toBe('admin');
    expect((await s.api('GET', `/api/teams/${teamId}`, admin.token)).status).toBe(404);
  });

  it('regenerating the invite code invalidates the old one', async () => {
    const { teamId, admin, code } = await team(s, 'Ada');
    const r = await s.api('POST', `/api/teams/${teamId}/invite`, admin.token);
    expect(r.body.inviteCode).not.toBe(code);
    const p = await person(s, 'Late');
    expect((await s.api('POST', '/api/teams/join', p.token, { code })).status).toBe(404);
    expect((await s.api('POST', '/api/teams/join', p.token, { code: r.body.inviteCode })).status).toBe(200);
  });

  it('signs in on another device with a one-time code', async () => {
    const p = await person(s, 'Ada');
    const link = await s.api('POST', '/api/me/device-link', p.token);
    expect(link.body.code).toMatch(/^[A-Z0-9]{8}$/);
    const redeemed = await s.api('POST', '/api/device-link/redeem', null, { code: link.body.code.toLowerCase() });
    expect(redeemed.body.user.id).toBe(p.id);
    expect(redeemed.body.token).not.toBe(p.token);
    expect((await s.api('POST', '/api/device-link/redeem', null, { code: link.body.code })).status).toBe(404);
  });

  it('erases a person on request', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    expect((await s.api('DELETE', '/api/me', members[0]!.token)).status).toBe(200);
    expect((await s.api('GET', '/api/me', members[0]!.token)).status).toBe(401);
    const snap = await s.api('GET', `/api/teams/${teamId}`, admin.token);
    expect(snap.body.team.members).toHaveLength(1);
    const names = await s.repo.userNames([members[0]!.id]);
    expect(names[members[0]!.id]).toBe('Former member');
  });
});

describe('backlog, sprints and the rest of the team data', () => {
  it('PATCH only changes the fields it is given', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const created = await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, {
      title: 'Log in',
      asA: 'student',
      iWant: 'to log in',
      soThat: 'I can see my grades',
      acceptanceCriteria: ['Given valid details, I am logged in'],
      estimate: '3',
    });
    expect(created.status).toBe(200);
    const patched = await s.api('PATCH', `/api/teams/${teamId}/stories/${created.body.id}`, admin.token, { status: 'doing' });
    expect(patched.body).toMatchObject({ title: 'Log in', asA: 'student', estimate: '3', status: 'doing', acceptanceCriteria: ['Given valid details, I am logged in'] });
    const done = await s.api('PATCH', `/api/teams/${teamId}/stories/${created.body.id}`, admin.token, { status: 'done' });
    expect(done.body.doneAt).toBeTruthy();
    const reopened = await s.api('PATCH', `/api/teams/${teamId}/stories/${created.body.id}`, admin.token, { status: 'todo' });
    expect(reopened.body.doneAt).toBeNull();
  });

  it('prevents access to another team’s records through your own team', async () => {
    const a = await team(s, 'Ada');
    const b = await team(s, 'Bob');
    const story = await s.api('POST', `/api/teams/${a.teamId}/stories`, a.admin.token, { title: 'Secret' });
    expect((await s.api('PATCH', `/api/teams/${b.teamId}/stories/${story.body.id}`, b.admin.token, { title: 'Pwned' })).status).toBe(404);
    await s.api('DELETE', `/api/teams/${b.teamId}/stories/${story.body.id}`, b.admin.token);
    const snap = await s.api('GET', `/api/teams/${a.teamId}`, a.admin.token);
    expect(snap.body.stories[0].title).toBe('Secret');
  });

  it('allows one active sprint and returns unfinished work to the backlog when closing', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const s1 = (await s.api('POST', `/api/teams/${teamId}/sprints`, admin.token, { name: 'Sprint 1', goal: 'Login works' })).body;
    const s2 = (await s.api('POST', `/api/teams/${teamId}/sprints`, admin.token, { name: 'Sprint 2' })).body;
    expect((await s.api('PATCH', `/api/teams/${teamId}/sprints/${s1.id}`, admin.token, { status: 'active' })).status).toBe(200);
    const clash = await s.api('PATCH', `/api/teams/${teamId}/sprints/${s2.id}`, admin.token, { status: 'active' });
    expect(clash.status).toBe(400);
    expect(clash.body.error).toMatch(/still active/);
    await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, { title: 'Done one', sprintId: s1.id, status: 'done', estimate: '5' });
    await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, { title: 'Unfinished', sprintId: s1.id, status: 'doing' });
    const closed = await s.api('POST', `/api/teams/${teamId}/sprints/${s1.id}/close`, admin.token);
    expect(closed.body.returned).toBe(1);
    const snap = await s.api('GET', `/api/teams/${teamId}`, admin.token);
    const byTitle = Object.fromEntries(snap.body.stories.map((x: any) => [x.title, x]));
    expect(byTitle['Unfinished']).toMatchObject({ sprintId: null, status: 'backlog' });
    expect(byTitle['Done one'].sprintId).toBe(s1.id);
    expect(snap.body.sprints.find((x: any) => x.id === s1.id).status).toBe('closed');
  });

  it('manages charter items, actions and risks', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const item = await s.api('POST', `/api/teams/${teamId}/charter`, admin.token, { kind: 'agreement', text: 'Cameras optional' });
    expect(item.body.position).toBeGreaterThan(0);
    await s.api('PATCH', `/api/teams/${teamId}/charter/${item.body.id}`, admin.token, { text: 'Cameras on when possible' });
    const action = await s.api('POST', `/api/teams/${teamId}/actions`, admin.token, { text: 'Pair on the CI pipeline', ownerId: admin.id });
    await s.api('PATCH', `/api/teams/${teamId}/actions/${action.body.id}`, admin.token, { status: 'done' });
    const risk = await s.api('POST', `/api/teams/${teamId}/risks`, admin.token, { title: 'Personal data in logs', category: 'legal', likelihood: 2, impact: 3 });
    expect(risk.status).toBe(200);
    expect((await s.api('PATCH', `/api/teams/${teamId}/risks/${risk.body.id}`, admin.token, { likelihood: 4 })).status).toBe(400);
    await s.api('PATCH', `/api/teams/${teamId}/risks/${risk.body.id}`, admin.token, { status: 'mitigated' });
    const snap = await s.api('GET', `/api/teams/${teamId}`, admin.token);
    expect(snap.body.charter.find((c: any) => c.id === item.body.id).text).toBe('Cameras on when possible');
    expect(snap.body.actions[0]).toMatchObject({ status: 'done' });
    expect(snap.body.actions[0].completedAt).toBeTruthy();
    expect(snap.body.risks[0]).toMatchObject({ title: 'Personal data in logs', category: 'legal', likelihood: 2, impact: 3, status: 'mitigated' });
  });

  it('bulk-imports stories and exports CSV safely', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const r = await s.api('POST', `/api/teams/${teamId}/stories/bulk`, admin.token, {
      stories: [{ title: '=HYPERLINK("http://evil")' }, { title: 'Search, "quoted"', externalUrl: 'https://git.example.ac.uk/team/project/-/issues/3' }],
    });
    expect(r.body.created).toBe(2);
    const csv = await s.api('GET', `/api/teams/${teamId}/stories.csv`, admin.token);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv.text).toContain('"Search, ""quoted"""');
    expect((await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, { title: 'x', externalUrl: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('exports team data without the invite code', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const r = await s.api('GET', `/api/teams/${teamId}/export.json`, admin.token);
    expect(r.body.format).toBe('sprintwell-export');
    expect(r.body.team.inviteCode).toBeUndefined();
  });

  it('deletes a team for admins only', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    expect((await s.api('DELETE', `/api/teams/${teamId}`, members[0]!.token)).status).toBe(403);
    expect((await s.api('DELETE', `/api/teams/${teamId}`, admin.token)).status).toBe(200);
    expect((await s.api('GET', `/api/teams/${teamId}`, admin.token)).status).toBe(404);
  });
});

describe('hardening', () => {
  it('only accepts current members as owners', async () => {
    const a = await team(s, 'Ada', 'Grace');
    const outsider = await person(s, 'Eve');
    const r = await s.api('POST', `/api/teams/${a.teamId}/actions`, a.admin.token, { text: 'x', ownerId: outsider.id });
    expect(r.status).toBe(400);
    const ok = await s.api('POST', `/api/teams/${a.teamId}/actions`, a.admin.token, { text: 'x', ownerId: a.members[0]!.id });
    expect(ok.status).toBe(200);
    const story = await s.api('POST', `/api/teams/${a.teamId}/stories`, a.admin.token, { title: 't' });
    const bad = await s.api('PATCH', `/api/teams/${a.teamId}/stories/${story.body.id}`, a.admin.token, { tasks: [{ id: 't1', text: 'x', done: false, ownerId: outsider.id }] });
    expect(bad.status).toBe(400);
  });

  it('rotates the invite link when an admin removes someone', async () => {
    const { teamId, admin, members, code } = await team(s, 'Ada', 'Grace');
    const r = await s.api('DELETE', `/api/teams/${teamId}/members/${members[0]!.id}`, admin.token);
    expect(r.body.inviteRotated).toBe(true);
    expect((await s.api('POST', '/api/teams/join', members[0]!.token, { code })).status).toBe(404);
  });
});

