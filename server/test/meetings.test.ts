import type { MeetingView } from '@sprintwell/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sleep, startServer, team, WsClient, type TestServer } from './helpers';

let s: TestServer;
const clients: WsClient[] = [];
beforeAll(async () => {
  s = await startServer();
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
afterAll(async () => {
  await s?.stop();
});

async function connect(token: string, teamId: string) {
  const c = await WsClient.connect(s, token, teamId);
  clients.push(c);
  return c;
}

async function meeting(teamId: string, token: string, kind: string, options: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const r = await s.api('POST', `/api/teams/${teamId}/meetings`, token, { kind, options, ...extra });
  if (r.status !== 200) throw new Error(r.text);
  return r.body.meetingId as string;
}

type Data<K extends MeetingView['kind']> = Extract<MeetingView, { kind: K }>['data'];
const poker = (v: MeetingView) => v.data as Data<'poker'>;
const retro = (v: MeetingView) => v.data as Data<'retro'>;

/** Waits until the predicate holds for the client's latest view. */
async function until(c: WsClient, id: string, pred: (v: MeetingView) => boolean) {
  for (let i = 0; i < 100; i++) {
    const v = c.view(id);
    if (v && pred(v)) return v;
    await sleep(20);
  }
  throw new Error('condition not met');
}

describe('websocket basics', () => {
  it('rejects people who are not in the team', async () => {
    const a = await team(s, 'Ada');
    const b = await team(s, 'Bob');
    const id = await meeting(a.teamId, a.admin.token, 'poker');
    const bob = await connect(b.admin.token, a.teamId);
    const err = bob.wait((m) => m.t === 'error');
    bob.send({ t: 'join', meetingId: id });
    expect(await err).toMatchObject({ t: 'error' });
    expect((await bob.cmd(id, { type: 'vote', value: '3' })).ok).toBe(false);
  });

  it('closes unauthenticated sockets that send a bad token', async () => {
    const ws = new (await import('ws')).default(s.base.replace('http', 'ws') + '/ws?team=nosuchteam');
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send(JSON.stringify({ t: 'auth', token: 'nope' }));
    expect(await closed).toBe(4001);
  });

  it('tells team subscribers when data changes', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const c = await connect(admin.token, teamId);
    c.send({ t: 'sub', teamId });
    await sleep(50);
    const note = c.wait((m) => m.t === 'team' && m.teamId === teamId);
    await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, { title: 'New' });
    expect(await note).toEqual({ t: 'team', teamId });
  });
});

describe('Planning Poker', () => {
  it('keeps votes hidden until reveal and writes the final estimate to the story', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace', 'Linus');
    const story = (await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, { title: 'Search courses' })).body;
    const id = await meeting(teamId, admin.token, 'poker', { storyIds: [story.id], deckId: 'fibonacci' });
    const ada = await connect(admin.token, teamId);
    const grace = await connect(members[0]!.token, teamId);
    const linus = await connect(members[1]!.token, teamId);
    for (const c of [ada, grace, linus]) await c.join(id);

    await ada.ok(id, { type: 'vote', value: '3' });
    await grace.ok(id, { type: 'vote', value: '13' });
    const seenByLinus = await until(linus, id, (v) => poker(v).items[0]!.voted.length === 2);
    const item = poker(seenByLinus).items[0]!;
    expect(item.votes).toBeNull();
    expect(item.myVote).toBeNull();
    expect(JSON.stringify(poker(seenByLinus).items)).not.toContain('"13"');

    expect((await grace.cmd(id, { type: 'reveal' })).ok).toBe(false); // only the facilitator
    expect((await linus.cmd(id, { type: 'vote', value: '7' })).ok).toBe(false); // not in the deck
    await linus.ok(id, { type: 'vote', value: '5' });
    const revealed = poker(await ada.ok(id, { type: 'reveal' })).items[0]!;
    expect(revealed.votes).toEqual({ [admin.id]: '3', [members[0]!.id]: '13', [members[1]!.id]: '5' });
    expect(revealed.stats).toMatchObject({ consensus: false, explainers: { low: '3', high: '13' }, suggestion: '5' });
    expect((await grace.cmd(id, { type: 'vote', value: '5' })).ok).toBe(false); // already revealed

    const second = poker(await ada.ok(id, { type: 'revote' })).items[0]!;
    expect(second).toMatchObject({ round: 2, revealed: false, voted: [] });
    expect(second.history).toHaveLength(1);

    await ada.ok(id, { type: 'finalise', value: '5' });
    const snap = await s.api('GET', `/api/teams/${teamId}`, admin.token);
    expect(snap.body.stories[0].estimate).toBe('5');
  });

  it('auto-reveals when everyone present has voted, ignoring observers', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace', 'Olga');
    const id = await meeting(teamId, admin.token, 'poker', { autoReveal: true });
    const ada = await connect(admin.token, teamId);
    const grace = await connect(members[0]!.token, teamId);
    const olga = await connect(members[1]!.token, teamId);
    for (const c of [ada, grace, olga]) await c.join(id);
    await ada.ok(id, { type: 'addItems', titles: ['Export to CSV'] });
    await olga.ok(id, { type: 'setObserver', observer: true });
    expect((await olga.cmd(id, { type: 'vote', value: '3' })).ok).toBe(false);
    await ada.ok(id, { type: 'vote', value: '8' });
    expect(poker(ada.view(id)).items[0]!.revealed).toBe(false);
    await grace.ok(id, { type: 'vote', value: '8' });
    const v = await until(olga, id, (x) => poker(x).items[0]!.revealed);
    expect(poker(v).items[0]!.stats?.consensus).toBe(true);
  });

  it('lets someone claim facilitation when the facilitator has gone', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const id = await meeting(teamId, admin.token, 'poker');
    const ada = await connect(admin.token, teamId);
    const grace = await connect(members[0]!.token, teamId);
    await ada.join(id);
    await grace.join(id);
    expect((await grace.cmd(id, { type: 'claimFacilitator' })).ok).toBe(false);
    ada.close();
    await until(grace, id, (v) => !v.online.includes(admin.id));
    const v = await grace.ok(id, { type: 'claimFacilitator' });
    expect(v.facilitatorId).toBe(members[0]!.id);
  });
});

describe('Retrospective', () => {
  it('runs the full flow with hidden writing, grouping, dot voting and anonymity', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const id = await meeting(teamId, admin.token, 'retro', { templateId: 'start-stop-continue' });
    const ada = await connect(admin.token, teamId);
    const grace = await connect(members[0]!.token, teamId);
    await ada.join(id);
    await grace.join(id);

    await ada.ok(id, { type: 'checkin', word: 'Tired', esvp: 'shopper' });
    await grace.ok(id, { type: 'checkin', word: 'Excited', esvp: 'explorer' });
    expect(retro(ada.view(id)).esvp).toMatchObject({ shopper: 1, explorer: 1 });
    expect((await ada.cmd(id, { type: 'addCard', columnId: 'start', text: 'Too early' })).ok).toBe(false);

    await ada.ok(id, { type: 'setPhase', phase: 'reflect' });
    await ada.ok(id, { type: 'addCard', columnId: 'start', text: 'Pair more often' });
    await grace.ok(id, { type: 'addCard', columnId: 'start', text: 'Pair programming on hard stories' });
    await grace.ok(id, { type: 'addCard', columnId: 'stop', text: 'Merging without review' });
    const hidden = await until(ada, id, (v) => (retro(v).hiddenCounts.start ?? 0) === 1);
    expect(retro(hidden).cards.map((c) => c.text)).toEqual(['Pair more often']);
    expect(JSON.stringify(hidden)).not.toContain('Merging without review');

    await ada.ok(id, { type: 'setPhase', phase: 'group' });
    const all = retro(await until(grace, id, (v) => v.phase === 'group'));
    expect(all.cards).toHaveLength(3);
    expect(all.cards.every((c) => c.authorId === undefined)).toBe(true);
    const [mine, theirs] = [all.cards.find((c) => c.text === 'Pair programming on hard stories')!, all.cards.find((c) => c.text === 'Pair more often')!];
    expect(mine.mine).toBe(true);
    const grouped = retro(await grace.ok(id, { type: 'group', cardId: mine.id, intoCardId: theirs.id }));
    expect(grouped.groups).toHaveLength(1);
    const groupId = grouped.groups[0]!.id;
    await grace.ok(id, { type: 'renameGroup', groupId, title: 'Pair programming' });
    expect((await grace.cmd(id, { type: 'editCard', cardId: theirs.id, text: 'Hijack' })).ok).toBe(false);

    await ada.ok(id, { type: 'setPhase', phase: 'vote' });
    const stopCard = all.cards.find((c) => c.text === 'Merging without review')!;
    await ada.ok(id, { type: 'vote', topicId: groupId, delta: 1 });
    await ada.ok(id, { type: 'vote', topicId: groupId, delta: 1 });
    await ada.ok(id, { type: 'vote', topicId: stopCard.id, delta: 1 });
    const over = await ada.cmd(id, { type: 'vote', topicId: stopCard.id, delta: 1 });
    expect(over.ok).toBe(false);
    expect(over.error).toMatch(/used all your votes/);
    await grace.ok(id, { type: 'vote', topicId: stopCard.id, delta: 1 });
    expect(retro(grace.view(id)).totals).toBeNull();
    expect(retro(grace.view(id)).votesRemaining).toBe(2);

    await ada.ok(id, { type: 'setPhase', phase: 'discuss' });
    const disc = retro(await until(grace, id, (v) => v.phase === 'discuss'));
    expect(disc.totals).toEqual({ [groupId]: 2, [stopCard.id]: 2 });
    await ada.ok(id, { type: 'selectTopic', topicId: groupId });
    await grace.ok(id, { type: 'note', topicId: groupId, text: 'Agree to pair on anything above 5 points' });
    const action = await s.api('POST', `/api/teams/${teamId}/actions`, admin.token, { text: 'Pair on stories over 5 points', ownerId: members[0]!.id, meetingId: id });
    expect(action.status).toBe(200);

    await ada.ok(id, { type: 'setPhase', phase: 'close' });
    await ada.ok(id, { type: 'roti', score: 4 });
    await grace.ok(id, { type: 'roti', score: 5 });
    await ada.ok(id, { type: 'end' });
    expect((await grace.cmd(id, { type: 'roti', score: 1 })).ok).toBe(false);

    const md = await s.api('GET', `/api/teams/${teamId}/meetings/${id}/summary.md`, admin.token);
    expect(md.status).toBe(200);
    expect(md.text).toContain('Pair programming');
    expect(md.text).toContain('Pair on stories over 5 points');
    expect(md.text).toContain('4.5 / 5');
    // Anonymous: no author names next to cards.
    expect(md.text).not.toMatch(/Merging without review \(Grace\)/);
  });

  it('shows authors when the retrospective is not anonymous', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const id = await meeting(teamId, admin.token, 'retro', { templateId: 'mad-sad-glad', anonymous: false });
    const ada = await connect(admin.token, teamId);
    await ada.join(id);
    await ada.ok(id, { type: 'setPhase', phase: 'reflect' });
    const v = retro(await ada.ok(id, { type: 'addCard', columnId: 'glad', text: 'Shipped!' }));
    expect(v.cards[0]!.authorId).toBe(admin.id);
  });

  it('supports custom columns', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const id = await meeting(teamId, admin.token, 'retro', { templateId: 'custom', columns: [{ title: 'Kudos', prompt: 'Thank someone' }, { title: '' }] });
    const ada = await connect(admin.token, teamId);
    const v = retro(await ada.join(id));
    expect(v.columns.map((c) => c.title)).toEqual(['Kudos']);
  });
});

describe('Other Scrum events', () => {
  it('Daily Scrum moves through speakers and restarts the timer', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const id = await meeting(teamId, admin.token, 'daily', { perPersonSeconds: 60 });
    const ada = await connect(admin.token, teamId);
    const grace = await connect(members[0]!.token, teamId);
    const v0 = await ada.join(id);
    await grace.join(id);
    expect((v0.data as Data<'daily'>).order).toHaveLength(2);
    await grace.ok(id, { type: 'setUpdate', yesterday: 'Login form', today: 'Tests', blockers: 'Waiting for API key' });
    expect((await grace.cmd(id, { type: 'next' })).ok).toBe(false);
    const v1 = await ada.ok(id, { type: 'next' });
    expect((v1.data as Data<'daily'>).current).toBe(1);
    expect(v1.timer.endsAt).toBeGreaterThan(Date.now() + 50_000);
    await ada.ok(id, { type: 'addParking', text: 'Discuss API key with the client' });
    const md = await s.api('GET', `/api/teams/${teamId}/meetings/${id}/summary.md`, admin.token);
    expect(md.text).toContain('Waiting for API key');
    expect(md.text).toContain('Grace');
  });

  it('Sprint Planning creates the next sprint and records capacity', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const id = await meeting(teamId, admin.token, 'planning');
    const ada = await connect(admin.token, teamId);
    const v = await ada.join(id);
    expect(v.sprintId).toBeTruthy();
    expect(v.title).toBe('Sprint Planning: Sprint 1');
    const data = v.data as Data<'planning'>;
    expect(data.capacity).toHaveLength(2);
    await ada.ok(id, { type: 'setCapacity', row: { userId: members[0]!.id, daysAvailable: 8, hoursPerDay: 6, focusPercent: 70 } });
    expect((await ada.cmd(id, { type: 'setCapacity', row: { userId: 'nobody', daysAvailable: 1, hoursPerDay: 1, focusPercent: 1 } })).ok).toBe(false);
    const snap = await s.api('GET', `/api/teams/${teamId}`, admin.token);
    const sprint = snap.body.sprints.find((x: any) => x.id === v.sprintId);
    expect(sprint.capacity.find((r: any) => r.userId === members[0]!.id)).toMatchObject({ daysAvailable: 8, focusPercent: 70 });
  });

  it('Sprint Review collects feedback', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const sprint = (await s.api('POST', `/api/teams/${teamId}/sprints`, admin.token, { name: 'Sprint 1' })).body;
    const id = await meeting(teamId, admin.token, 'review', {}, { sprintId: sprint.id });
    const ada = await connect(admin.token, teamId);
    await ada.join(id);
    const v = await ada.ok(id, { type: 'addFeedback', text: 'Add dark mode', from: 'Client' });
    const fb = (v.data as Data<'review'>).feedback[0]!;
    const story = (await s.api('POST', `/api/teams/${teamId}/stories`, admin.token, { title: fb.text })).body;
    const v2 = await ada.ok(id, { type: 'markFeedbackAdded', feedbackId: fb.id, storyId: story.id });
    expect((v2.data as Data<'review'>).feedback[0]!.backlogStoryId).toBe(story.id);
  });

  it('Pairing timer rotates the driver automatically', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const id = await meeting(teamId, admin.token, 'pairing', { participants: [admin.id, members[0]!.id] });
    const ada = await connect(admin.token, teamId);
    await ada.join(id);
    await ada.ok(id, { type: 'setInterval', seconds: 30 });
    // Use a 1-second timer to trigger the server-side rotation quickly.
    await ada.ok(id, { type: 'timerStart', seconds: 1 });
    const rotated = await until(ada, id, (v) => (v.data as Data<'pairing'>).rotations === 1);
    expect((rotated.data as Data<'pairing'>).driverIndex).toBe(1);
    expect(rotated.timer.durationMs).toBe(30_000);
  }, 10_000);

  it('only the facilitator or an admin can delete a meeting', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Grace');
    const id = await meeting(teamId, admin.token, 'poker');
    expect((await s.api('DELETE', `/api/teams/${teamId}/meetings/${id}`, members[0]!.token)).status).toBe(403);
    expect((await s.api('DELETE', `/api/teams/${teamId}/meetings/${id}`, admin.token)).status).toBe(200);
  });
});

describe('hardening', () => {
  it('refuses to switch identity on an authenticated socket', async () => {
    const { teamId, admin, members } = await team(s, 'Ada', 'Mallory');
    const id = await meeting(teamId, admin.token, 'retro');
    const mallory = await connect(members[0]!.token, teamId);
    await mallory.join(id);
    const other = await s.api('POST', '/api/session', null, { displayName: 'Sock puppet' });
    const err = mallory.wait((m) => m.t === 'error');
    mallory.send({ t: 'auth', token: other.body.token });
    expect(await err).toEqual({ t: 'error', error: 'Already signed in' });
    // After removal, the socket stops receiving the meeting.
    await s.api('DELETE', `/api/teams/${teamId}/members/${members[0]!.id}`, admin.token);
    await sleep(50);
    const before = mallory.messages.filter((m) => m.t === 'meeting').length;
    const ada = await connect(admin.token, teamId);
    await ada.join(id);
    await ada.ok(id, { type: 'setPhase', phase: 'reflect' });
    await ada.ok(id, { type: 'addCard', columnId: 'start', text: 'Secret' });
    await sleep(100);
    expect(mallory.messages.filter((m) => m.t === 'meeting').length).toBe(before);
  });

  it('escapes Markdown in summaries', async () => {
    const { teamId, admin } = await team(s, 'Ada');
    const id = await meeting(teamId, admin.token, 'poker');
    const ada = await connect(admin.token, teamId);
    await ada.join(id);
    await ada.ok(id, { type: 'rename', title: 'x\n\n## Grades [link](https://evil)' });
    const md = await s.api('GET', `/api/teams/${teamId}/meetings/${id}/summary.md`, admin.token);
    expect(md.text).not.toContain('\n## Grades');
    expect(md.text).toContain('\\[link\\]');
  });

  it('rejects Sprint Review stories from another team', async () => {
    const a = await team(s, 'Ada');
    const b = await team(s, 'Bob');
    const foreign = (await s.api('POST', `/api/teams/${b.teamId}/stories`, b.admin.token, { title: 'Not yours' })).body;
    const sprint = (await s.api('POST', `/api/teams/${a.teamId}/sprints`, a.admin.token, { name: 'S1' })).body;
    const id = await meeting(a.teamId, a.admin.token, 'review', {}, { sprintId: sprint.id });
    const ada = await connect(a.admin.token, a.teamId);
    await ada.join(id);
    expect((await ada.cmd(id, { type: 'setDemoed', storyId: foreign.id, demoed: true })).ok).toBe(false);
  });
});

