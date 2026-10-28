import type { MeetingView } from '@sprintwell/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { gitlabTokenVerify, person, sleep, startWithGitlab, WsClient, type TestServer } from './helpers';
import type { MockGitlab } from './mock-gitlab';

let s: TestServer;
let gitlab: MockGitlab;
const clients: WsClient[] = [];
beforeAll(async () => {
  ({ s, gitlab } = await startWithGitlab({ oauth: false }));
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
afterAll(async () => {
  await s?.stop();
});

let nextGitlabId = Math.floor(Math.random() * 1e9);
/** A student who has signed in with GitLab. */
async function student(name: string) {
  const p = await person(s, name);
  const username = `${name.toLowerCase()}${nextGitlabId}`;
  await gitlabTokenVerify(s, gitlab, { id: nextGitlabId++, username, name }, p.token);
  return { ...p, username };
}

async function classWithTeams(names = ['Team 1', 'Team 2']) {
  const teacher = await person(s, 'Teacher');
  const { classId } = (await s.api('POST', '/api/classes', teacher.token, { name: 'CMT651 26/27' })).body;
  const { teamIds } = (await s.api('POST', `/api/classes/${classId}/teams`, teacher.token, { names })).body;
  const cls = (await s.api('GET', `/api/classes/${classId}`, teacher.token)).body;
  return { teacher, classId, teamIds: teamIds as string[], cls };
}

async function until(c: WsClient, id: string, pred: (v: MeetingView) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = c.view(id);
    if (v && pred(v)) return v;
    await sleep(20);
  }
  throw new Error('condition not met');
}

describe('classes', () => {
  it('lets teaching staff create teams that students join after signing in with GitLab', async () => {
    const { teacher, teamIds, cls } = await classWithTeams();
    expect(cls.teams.map((t: { name: string }) => t.name)).toEqual(['Team 1', 'Team 2']);
    expect(cls.teams[0].members).toEqual([]);
    const code = cls.teams[0].inviteCode;

    const anon = await person(s, 'Anonymous');
    const refused = await s.api('POST', '/api/teams/join', anon.token, { code });
    expect(refused.status).toBe(403);
    expect(refused.body.details.code).toBe('gitlab_required');

    const ada = await student('Ada');
    const grace = await student('Grace');
    expect((await s.api('POST', '/api/teams/join', ada.token, { code })).status).toBe(200);
    expect((await s.api('POST', '/api/teams/join', grace.token, { code })).status).toBe(200);
    const snap = (await s.api('GET', `/api/teams/${teamIds[0]}`, ada.token)).body;
    expect(snap.team.members.map((m: { role: string }) => m.role)).toEqual(['admin', 'member']);
    expect(snap.team.classInfo).toMatchObject({ name: 'CMT651 26/27', requireGitlab: true });

    // One team per class.
    const second = await s.api('POST', '/api/teams/join', ada.token, { code: cls.teams[1].inviteCode });
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already in Team 1/);

    // The teacher is not a member, but can see the team, read-only.
    const asTeacher = await s.api('GET', `/api/teams/${teamIds[0]}`, teacher.token);
    expect(asTeacher.body.team.myRole).toBe('coach');
    const write = await s.api('POST', `/api/teams/${teamIds[0]}/stories`, teacher.token, { title: 'Teacher story' });
    expect(write.status).toBe(403);
    // …and can manage membership; an emptied class team is kept for the next students.
    expect((await s.api('DELETE', `/api/teams/${teamIds[0]}/members/${grace.id}`, teacher.token)).status).toBe(200);
    expect((await s.api('DELETE', `/api/teams/${teamIds[0]}/members/${ada.id}`, teacher.token)).status).toBe(200);
    expect((await s.api('GET', `/api/teams/${teamIds[0]}`, teacher.token)).status).toBe(200);
  });

  it('protects class teams: only the class owner deletes them, and students stay signed in with GitLab', async () => {
    const { teacher, cls, teamIds } = await classWithTeams(['Protected']);
    const ada = await student('Ada');
    await s.api('POST', '/api/teams/join', ada.token, { code: cls.teams[0].inviteCode });
    const colleague = await person(s, 'Colleague');
    await s.api('POST', '/api/classes/join-staff', colleague.token, { code: cls.staffCode });
    expect((await s.api('DELETE', `/api/teams/${teamIds[0]}`, ada.token)).status).toBe(403);
    expect((await s.api('DELETE', `/api/teams/${teamIds[0]}`, colleague.token)).status).toBe(403);
    const disconnect = await s.api('DELETE', '/api/me/gitlab', ada.token);
    expect(disconnect.status).toBe(400);
    expect(disconnect.body.error).toMatch(/GitLab account to stay linked/);
    expect((await s.api('DELETE', `/api/teams/${teamIds[0]}`, teacher.token)).status).toBe(200);
  });

  it('keeps the Definition of Ready gate on in class teams', async () => {
    const { cls, teamIds } = await classWithTeams(['Gate team']);
    const ada = await student('Ada');
    await s.api('POST', '/api/teams/join', ada.token, { code: cls.teams[0].inviteCode });
    await s.api('PATCH', `/api/teams/${teamIds[0]}`, ada.token, { settings: { enforceReady: false } });
    expect((await s.api('GET', `/api/teams/${teamIds[0]}`, ada.token)).body.team.settings.enforceReady).toBe(true);
  });

  it('can allow link-and-name students, add co-teachers and be deleted without losing students’ work', async () => {
    const { teacher, classId, cls, teamIds } = await classWithTeams(['Kept', 'Empty']);
    await s.api('PATCH', `/api/classes/${classId}`, teacher.token, { settings: { requireGitlab: false, resources: [{ title: 'Module slides', url: 'https://example.ac.uk/slides' }] } });
    const linus = await person(s, 'Linus');
    const kept = cls.teams.find((t: { id: string }) => t.id === teamIds[0]);
    expect((await s.api('POST', '/api/teams/join', linus.token, { code: kept.inviteCode })).status).toBe(200);
    expect((await s.api('GET', `/api/teams/${teamIds[0]}`, linus.token)).body.team.classInfo.resources[0].title).toBe('Module slides');

    const colleague = await person(s, 'Colleague');
    expect((await s.api('POST', '/api/classes/join-staff', colleague.token, { code: cls.staffCode })).status).toBe(200);
    expect((await s.api('GET', `/api/teams/${teamIds[0]}`, colleague.token)).body.team.myRole).toBe('coach');
    expect((await s.api('DELETE', `/api/classes/${classId}`, colleague.token)).status).toBe(403);

    const del = await s.api('DELETE', `/api/classes/${classId}`, teacher.token);
    expect(del.body.deletedTeams).toBe(1);
    expect((await s.api('GET', `/api/teams/${teamIds[0]}`, linus.token)).body.team.classInfo).toBeNull();
    expect((await s.api('GET', `/api/teams/${teamIds[0]}`, teacher.token)).status).toBe(404);
  });
});

describe('activity log', () => {
  it('records who did what, with GitLab usernames in the CSV for teaching staff', async () => {
    const { teacher, classId, cls, teamIds } = await classWithTeams(['Log team']);
    const teamId = teamIds[0]!;
    const ada = await student('Ada');
    const grace = await student('Grace');
    for (const p of [ada, grace]) await s.api('POST', '/api/teams/join', p.token, { code: cls.teams[0].inviteCode });

    const story = (await s.api('POST', `/api/teams/${teamId}/stories`, ada.token, { title: 'Book a slot' })).body;
    await s.api('PATCH', `/api/teams/${teamId}/stories/${story.id}`, grace.token, { acceptanceCriteria: ['Given…'] });

    const { meetingId } = (await s.api('POST', `/api/teams/${teamId}/meetings`, ada.token, { kind: 'poker', options: { storyIds: [story.id] } })).body;
    const a = await WsClient.connect(s, ada.token, teamId);
    const g = await WsClient.connect(s, grace.token, teamId);
    const t = await WsClient.connect(s, teacher.token, teamId);
    clients.push(a, g, t);
    for (const c of [a, g, t]) c.send({ t: 'join', meetingId });
    await until(a, meetingId, (v) => v.online.length === 2);
    // Teaching staff watching do not count as present, so they never hold up the vote.
    expect((await until(t, meetingId, () => true)).online.sort()).toEqual([ada.id, grace.id].sort());
    expect((await t.cmd(meetingId, { type: 'vote', value: '3' })).ok).toBe(false);
    await a.cmd(meetingId, { type: 'vote', value: '5' });
    await a.cmd(meetingId, { type: 'vote', value: '8' });
    await g.cmd(meetingId, { type: 'vote', value: '5' });

    const log = (await s.api('GET', `/api/teams/${teamId}/activity`, teacher.token)).body;
    const lines = log.entries.map((e: { userId: string; summary: string }) => `${log.names[e.userId]}: ${e.summary}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Ada: joined the team',
        'Ada: wrote “Book a slot”',
        'Grace: edited “Book a slot” (acceptance criteria)',
        'Ada: started Planning Poker',
        expect.stringMatching(/^Ada: took part in Planning Poker/),
        'Ada: voted on “Book a slot” (round 1)',
        'Grace: voted on “Book a slot” (round 1)',
      ]),
    );
    // Voting twice in a round is one entry, and no vote values are logged.
    expect(lines.filter((l: string) => l.startsWith('Ada: voted')).length).toBe(1);
    expect(lines.some((l: string) => /\b[58]\b/.test(l) && l.includes('voted'))).toBe(false);
    expect(lines.some((l: string) => l.startsWith('Teacher'))).toBe(false);

    // Students can read their own team's log too; others cannot.
    expect((await s.api('GET', `/api/teams/${teamId}/activity?userId=${grace.id}`, ada.token)).body.entries.every((e: { userId: string }) => e.userId === grace.id)).toBe(true);
    expect((await s.api('GET', `/api/teams/${teamId}/activity`, (await person(s, 'Outsider')).token)).status).toBe(404);

    const csv = await s.api('GET', `/api/teams/${teamId}/activity.csv`, teacher.token);
    expect(csv.text).toContain(ada.username);
    const summary = await s.api('GET', `/api/classes/${classId}/activity.csv`, teacher.token);
    expect(summary.text.split('\r\n')[0]).toContain('Planning Poker');
    expect(summary.text).toContain(`"Log team","Grace","${grace.username}","yes"`);
  });

  it('never attributes anonymous retrospective cards', async () => {
    const { cls, teamIds } = await classWithTeams(['Retro team']);
    const teamId = teamIds[0]!;
    const ada = await student('Ada');
    await s.api('POST', '/api/teams/join', ada.token, { code: cls.teams[0].inviteCode });
    const anon = (await s.api('POST', `/api/teams/${teamId}/meetings`, ada.token, { kind: 'retro', options: { templateId: 'start-stop-continue', anonymous: true } })).body.meetingId;
    const open = (await s.api('POST', `/api/teams/${teamId}/meetings`, ada.token, { kind: 'retro', options: { templateId: 'start-stop-continue', anonymous: false } })).body.meetingId;
    const a = await WsClient.connect(s, ada.token, teamId);
    clients.push(a);
    for (const id of [anon, open]) {
      a.send({ t: 'join', meetingId: id });
      await until(a, id, () => true);
      await a.cmd(id, { type: 'setPhase', phase: 'reflect' });
      const col = a.view(id)!.data as { columns: { id: string }[] };
      await a.cmd(id, { type: 'addCard', columnId: col.columns[0]!.id, text: id === anon ? 'secret card' : 'open card' });
    }
    const log = (await s.api('GET', `/api/teams/${teamId}/activity`, ada.token)).body.entries.map((e: { summary: string }) => e.summary);
    // Card text is never logged (cards are hidden while people write); anonymous cards are not logged at all.
    expect(log.some((x: string) => x.includes('secret card') || x.includes('open card'))).toBe(false);
    expect(log.filter((x: string) => x.startsWith('wrote a retrospective card')).length).toBe(1);
  });
});
