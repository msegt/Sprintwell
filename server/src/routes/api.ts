import {
  LIMITS,
  ACTIVITY_KIND_NAMES,
  MEETING_INFO,
  storySentence,
  type StoryDTO,
  type TeamRole,
  type UserDTO,
} from '@sprintwell/shared';
import {
  actionBody,
  actionPatchBody,
  bulkStoriesBody,
  charterItemBody,
  charterUpdateBody,
  createMeetingBody,
  createSessionBody,
  createTeamBody,
  activityQuery,
  classTeamsBody,
  createClassBody,
  deviceLinkRedeemBody,
  joinStaffBody,
  updateClassBody,
  gitlabCallbackBody,
  gitlabStartBody,
  joinTeamBody,
  reorderBody,
  riskBody,
  riskPatchBody,
  setRoleBody,
  sprintBody,
  sprintPatchBody,
  storyBody,
  storyPatchBody,
  updateMeBody,
  updateTeamBody,
} from '@sprintwell/shared/schemas';
import type { ZodType } from 'zod';
import type { Config } from '../config';
import type { MeetingManager } from '../meetings/manager';
import type { Repo } from '../repo';
import { activityCounts, listActivity, logActivity, type ActivityEntry } from '../activity';
import { Classes } from '../classes';
import { GitlabAuth } from '../gitlab/auth';
import { FileResponse, type ApiRequest, type ApiRouter, type RealtimeControl } from './router';
import { HttpError, badRequest, forbidden, notFound } from '../util';

export interface Deps {
  repo: Repo;
  realtime: RealtimeControl;
  meetings: MeetingManager;
  config: Config;
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path.join('.');
    throw badRequest(issue ? `${field ? `${field}: ` : ''}${issue.message}` : 'Invalid request');
  }
  return r.data;
}

function bearer(req: ApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

type Params = Record<string, string>;

export function registerApi(app: ApiRouter, deps: Deps): void {
  const { repo, realtime, meetings, config } = deps;

  async function user(req: ApiRequest): Promise<UserDTO> {
    const token = bearer(req);
    const u = token ? await repo.userForToken(token) : null;
    if (!u) throw new HttpError(401, 'Please join or create a team first.');
    return u;
  }

  /**
   * The signed-in person's access to a team. Teaching staff of the team's class
   * ('coach') may read everything but not change the team's work.
   */
  async function member(req: ApiRequest, teamId: string, mode: 'read' | 'write' = 'write'): Promise<{ user: UserDTO; role: TeamRole }> {
    const u = await user(req);
    const role = await repo.access(teamId, u.id);
    if (!role) throw notFound('Team not found');
    if (role === 'coach' && mode === 'write') throw forbidden('Teaching staff can see this team but not change its work.');
    return { user: u, role };
  }

  /** Team admins, and teaching staff of the team's class (membership and settings only). */
  async function admin(req: ApiRequest, teamId: string) {
    const m = await member(req, teamId, 'read');
    if (m.role !== 'admin' && m.role !== 'coach') throw forbidden('Only team admins can do that.');
    return m;
  }

  const log = (teamId: string, userId: string | null, kind: ActivityEntry['kind'], summary: string) => logActivity(repo.db, { teamId, userId, kind, summary });
  const q = (s: string) => `“${s}”`;

  const changed = (teamId: string) => realtime.notifyTeam(teamId);
  const strictLimit = { strict: true };

  // ------------------------------------------------------------ public

  const gitlab = new GitlabAuth(repo, config);
  const classes = new Classes(repo);

  app.get('/api/config', async () => ({
    appName: 'Sprintwell',
    version: config.version,
    donationUrl: config.donationUrl,
    sourceUrl: config.sourceUrl,
    gitlab: { enabled: gitlab.enabled, url: gitlab.enabled ? config.gitlab.url : '' },
  }));

  // ------------------------------------------------------------ GitLab sign-in

  app.post('/api/auth/gitlab/start', strictLimit, async (req) => {
    const body = parse(gitlabStartBody, req.body);
    const token = bearer(req);
    const current = token ? await repo.userForToken(token) : null;
    return { url: await gitlab.start({ purpose: body.purpose, userId: current?.id ?? null, returnTo: body.returnTo, origin: req.origin }) };
  });

  app.post('/api/auth/gitlab/callback', strictLimit, async (req) => {
    const body = parse(gitlabCallbackBody, req.body);
    const token = bearer(req);
    const current = token ? await repo.userForToken(token) : null;
    const result = await gitlab.finish({ code: body.code, state: body.state, origin: req.origin, currentUserId: current?.id ?? null });
    for (const t of await repo.teamsForUser(result.user.id)) changed(t.id);
    return result;
  });

  app.delete('/api/me/gitlab', async (req) => {
    const u = await user(req);
    await gitlab.disconnect(u.id);
    for (const t of await repo.teamsForUser(u.id)) changed(t.id);
    return { ok: true };
  });

  app.get('/api/invites/:code', strictLimit, async (req) => {
    const { code } = req.params as Params;
    const preview = await repo.invitePreview(code ?? '');
    if (!preview) throw notFound('That invite link is not valid any more. Ask your team for a new one.');
    const info = (await repo.team(preview.teamId, 'member')).classInfo;
    return { teamName: preview.teamName, memberCount: preview.memberCount, className: info?.name ?? null, requireGitlab: info?.requireGitlab ?? false };
  });

  // ------------------------------------------------------------ identity

  app.post('/api/session', strictLimit, async (req) => {
    const { displayName } = parse(createSessionBody, req.body);
    return repo.createUser(displayName);
  });

  app.get('/api/me', async (req) => {
    const u = await user(req);
    return { user: u, teams: await repo.teamsForUser(u.id) };
  });

  app.patch('/api/me', async (req) => {
    const u = await user(req);
    const { displayName } = parse(updateMeBody, req.body);
    await repo.renameUser(u.id, displayName);
    for (const t of await repo.teamsForUser(u.id)) changed(t.id);
    return { ok: true };
  });

  app.get('/api/me/export', async (req) => {
    const u = await user(req);
    const teams = await repo.teamsForUser(u.id);
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), user: u, teams }, null, 2);
    return new FileResponse(body, 'application/json; charset=utf-8', 'sprintwell-my-data.json');
  });

  app.delete('/api/me', async (req) => {
    const u = await user(req);
    const teams = await repo.deleteUser(u.id);
    for (const t of teams) {
      realtime.revoke(t, u.id);
      if (!(await repo.teamExists(t))) realtime.forgetTeam(t);
      changed(t);
    }
    return { ok: true };
  });

  app.post('/api/logout', async (req) => {
    const token = bearer(req);
    if (token) await repo.deleteSession(token);
    return { ok: true };
  });

  app.post('/api/me/device-link', strictLimit, async (req) => {
    const u = await user(req);
    return repo.createDeviceLink(u.id);
  });

  app.post('/api/device-link/redeem', strictLimit, async (req) => {
    const { code } = parse(deviceLinkRedeemBody, req.body);
    const result = await repo.redeemDeviceLink(code);
    if (!result) throw notFound('That code has expired or was already used. Create a new one on your other device.');
    return result;
  });

  // ------------------------------------------------------------ teams

  app.post('/api/teams', strictLimit, async (req) => {
    const u = await user(req);
    const body = parse(createTeamBody, req.body);
    const teams = await repo.teamsForUser(u.id);
    if (teams.length >= LIMITS.teamsPerPerson) throw badRequest(`You can be in up to ${LIMITS.teamsPerPerson} teams.`);
    return { teamId: await repo.createTeam(u.id, body.name, body.starterCharter) };
  });

  app.post('/api/teams/join', strictLimit, async (req) => {
    const u = await user(req);
    const { code } = parse(joinTeamBody, req.body);
    const preview = await repo.invitePreview(code);
    const mine = await repo.teamsForUser(u.id);
    if (preview && !mine.some((t) => t.id === preview.teamId) && mine.length >= LIMITS.teamsPerPerson) {
      throw badRequest(`You can be in up to ${LIMITS.teamsPerPerson} teams.`);
    }
    const before = await repo.membership(preview?.teamId ?? '', u.id);
    const teamId = await repo.joinTeam(code, u.id);
    if (!before) await log(teamId, u.id, 'team', 'joined the team');
    changed(teamId);
    return { teamId };
  });

  app.get('/api/teams/:teamId', async (req) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!, 'read');
    const ended = await meetings.endStale(teamId!);
    if (ended.length) {
      for (const id of ended) realtime.forgetMeeting(teamId!, id);
      changed(teamId!);
    }
    return repo.snapshot(teamId!, role);
  });

  app.patch('/api/teams/:teamId', async (req) => {
    const { teamId } = req.params as Params;
    await admin(req, teamId!);
    await repo.updateTeam(teamId!, parse(updateTeamBody, req.body));
    changed(teamId!);
    return { ok: true };
  });

  app.delete('/api/teams/:teamId', async (req) => {
    const { teamId } = req.params as Params;
    await admin(req, teamId!);
    const members = await repo.members(teamId!);
    await repo.deleteTeam(teamId!);
    realtime.forgetTeam(teamId!);
    changed(teamId!);
    for (const m of members) realtime.revoke(teamId!, m.userId);
    return { ok: true };
  });

  app.post('/api/teams/:teamId/invite', async (req) => {
    const { teamId } = req.params as Params;
    await admin(req, teamId!);
    const inviteCode = await repo.regenerateInvite(teamId!);
    changed(teamId!);
    return { inviteCode };
  });

  app.patch('/api/teams/:teamId/members/:userId', async (req) => {
    const { teamId, userId } = req.params as Params;
    await admin(req, teamId!);
    const { role } = parse(setRoleBody, req.body);
    await repo.setRole(teamId!, userId!, role);
    changed(teamId!);
    return { ok: true };
  });

  app.delete('/api/teams/:teamId/members/:userId', async (req) => {
    const { teamId, userId } = req.params as Params;
    const m = await member(req, teamId!, 'read');
    if (m.user.id !== userId && m.role !== 'admin' && m.role !== 'coach') throw forbidden('Only team admins can remove other people.');
    const removedName = (await repo.userNames([userId!]))[userId!] ?? 'Someone';
    await repo.removeMember(teamId!, userId!);
    if (await repo.teamExists(teamId!)) await log(teamId!, m.user.id, 'team', m.user.id === userId ? 'left the team' : `removed ${removedName} from the team`);
    realtime.revoke(teamId!, userId!);
    let inviteRotated = false;
    if (!(await repo.teamExists(teamId!))) {
      realtime.forgetTeam(teamId!);
    } else if (m.user.id !== userId) {
      // Stop the removed person rejoining with the link they already have.
      await repo.regenerateInvite(teamId!);
      inviteRotated = true;
    }
    changed(teamId!);
    return { ok: true, inviteRotated };
  });

  app.get('/api/teams/:teamId/export.json', async (req) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!, 'read');
    const snap = await repo.snapshot(teamId!, role);
    const summaries = [];
    const markdown = await meetings.teamSummaries(teamId!);
    for (const m of snap.meetings) summaries.push({ ...m, summaryMarkdown: markdown.get(m.id) ?? '' });
    const { inviteCode: _omit, ...team } = snap.team;
    const body = JSON.stringify({ format: 'sprintwell-export', version: 1, exportedAt: new Date().toISOString(), ...snap, team, meetings: summaries }, null, 2);
    return new FileResponse(body, 'application/json; charset=utf-8', `sprintwell-${slug(snap.team.name)}.json`);
  });

  app.get('/api/teams/:teamId/stories.csv', async (req) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!, 'read');
    const snap = await repo.snapshot(teamId!, role);
    const sprintName = new Map(snap.sprints.map((s) => [s.id, s.name]));
    const rows = [['title', 'description', 'estimate', 'status', 'sprint']];
    for (const s of snap.stories) {
      const description = [
        storySentence(s),
        s.acceptanceCriteria.length ? `\n**Acceptance criteria**\n${s.acceptanceCriteria.map((c) => `- [ ] ${c}`).join('\n')}` : '',
        s.notes ? `\n${s.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      rows.push([s.title, description, s.estimate ?? '', s.status, s.sprintId ? (sprintName.get(s.sprintId) ?? '') : '']);
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    return new FileResponse(csv, 'text/csv; charset=utf-8', `${slug(snap.team.name)}-stories.csv`);
  });

  // ------------------------------------------------------------ charter

  app.post('/api/teams/:teamId/charter', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const body = parse(charterItemBody, req.body);
    const item = await repo.addCharterItem(teamId!, u.id, body.kind, body.text);
    await log(teamId!, u.id, 'charter', `added to the ${CHARTER_NAMES[body.kind]}: ${q(body.text)}`);
    changed(teamId!);
    return item;
  });

  app.patch('/api/teams/:teamId/charter/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const text = parse(charterUpdateBody, req.body).text;
    await repo.updateCharterItem(teamId!, id!, u.id, text);
    await log(teamId!, u.id, 'charter', `edited a charter item: ${q(text)}`);
    changed(teamId!);
    return { ok: true };
  });

  app.delete('/api/teams/:teamId/charter/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    await repo.deleteCharterItem(teamId!, id!);
    await log(teamId!, u.id, 'charter', 'removed a charter item');
    changed(teamId!);
    return { ok: true };
  });

  app.post('/api/teams/:teamId/charter/reorder', async (req) => {
    const { teamId } = req.params as Params;
    await member(req, teamId!);
    await repo.reorder('charter_items', teamId!, parse(reorderBody, req.body).ids);
    changed(teamId!);
    return { ok: true };
  });

  // ------------------------------------------------------------ stories

  app.post('/api/teams/:teamId/stories', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const [story] = await repo.createStories(teamId!, [parse(storyBody, req.body)]);
    await log(teamId!, u.id, 'story', `wrote ${q(story!.title)}`);
    changed(teamId!);
    return story;
  });

  app.post('/api/teams/:teamId/stories/bulk', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const { stories } = parse(bulkStoriesBody, req.body);
    const created = await repo.createStories(
      teamId!,
      stories.map((s) => ({ ...parse(storyBody, { title: s.title, notes: s.notes, externalUrl: s.externalUrl, estimate: s.estimate }) })),
    );
    await log(teamId!, u.id, 'story', `added ${created.length} backlog item${created.length === 1 ? '' : 's'} at once`);
    changed(teamId!);
    return { created: created.length };
  });

  app.patch('/api/teams/:teamId/stories/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const before = await repo.story(teamId!, id!);
    const patch = stripUndefined(parse(storyPatchBody, req.body));
    const story = await repo.updateStory(teamId!, id!, patch);
    await log(teamId!, u.id, 'story', await describeStoryChange(before, story, patch));
    changed(teamId!);
    return story;
  });

  app.delete('/api/teams/:teamId/stories/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const gone = await repo.story(teamId!, id!).catch(() => null);
    await repo.deleteStory(teamId!, id!);
    if (gone) await log(teamId!, u.id, 'story', `deleted ${q(gone.title)}`);
    changed(teamId!);
    return { ok: true };
  });

  app.post('/api/teams/:teamId/stories/reorder', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    await repo.reorder('stories', teamId!, parse(reorderBody, req.body).ids);
    await logActivity(repo.db, { teamId: teamId!, userId: u.id, kind: 'story', summary: 'reordered the Product Backlog', dedupe: `reorder:${teamId}:${u.id}:${new Date().toISOString().slice(0, 13)}` });
    changed(teamId!);
    return { ok: true };
  });

  // ------------------------------------------------------------ sprints

  app.post('/api/teams/:teamId/sprints', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const sprint = await repo.createSprint(teamId!, parse(sprintBody, req.body));
    await log(teamId!, u.id, 'sprint', `created ${sprint.name}`);
    changed(teamId!);
    return sprint;
  });

  app.patch('/api/teams/:teamId/sprints/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const sp = stripUndefined(parse(sprintPatchBody, req.body));
    await repo.updateSprint(teamId!, id!, sp);
    const sprintName = (await repo.sprint(teamId!, id!)).name;
    await log(teamId!, u.id, 'sprint', sp.status === 'active' ? `started ${sprintName}` : sp.goal !== undefined ? `set the Sprint Goal of ${sprintName}: ${q(sp.goal)}` : `updated ${sprintName}`);
    changed(teamId!);
    return { ok: true };
  });

  app.post('/api/teams/:teamId/sprints/:id/close', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const result = await repo.closeSprint(teamId!, id!);
    await log(teamId!, u.id, 'sprint', `closed ${(await repo.sprint(teamId!, id!)).name}`);
    changed(teamId!);
    return result;
  });

  app.delete('/api/teams/:teamId/sprints/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.deleteSprint(teamId!, id!);
    changed(teamId!);
    return { ok: true };
  });

  // ------------------------------------------------------------ actions

  app.post('/api/teams/:teamId/actions', async (req) => {
    const { teamId } = req.params as Params;
    const { user: actor } = await member(req, teamId!);
    const body = parse(actionBody, req.body);
    const meetingId = typeof (req.body as { meetingId?: unknown })?.meetingId === 'string' ? (req.body as { meetingId: string }).meetingId : null;
    if (meetingId && (await meetings.teamOf(meetingId).catch(() => null)) !== teamId) throw badRequest('Unknown meeting');
    const action = await repo.createAction(teamId!, { ...body, meetingId });
    await log(teamId!, actor.id, 'action', `${body.kind === 'impediment' ? 'raised an impediment' : 'added an action'}: ${q(body.text)}`);
    changed(teamId!);
    return action;
  });

  app.patch('/api/teams/:teamId/actions/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const ap = stripUndefined(parse(actionPatchBody, req.body));
    await repo.updateAction(teamId!, id!, ap);
    if (ap.status === 'done') await log(teamId!, u.id, 'action', 'completed an action');
    changed(teamId!);
    return { ok: true };
  });

  app.delete('/api/teams/:teamId/actions/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.deleteAction(teamId!, id!);
    changed(teamId!);
    return { ok: true };
  });

  // ------------------------------------------------------------ risks

  app.post('/api/teams/:teamId/risks', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const risk = await repo.createRisk(teamId!, parse(riskBody, req.body));
    await log(teamId!, u.id, 'risk', `added the risk ${q(risk.title)}`);
    changed(teamId!);
    return risk;
  });

  app.patch('/api/teams/:teamId/risks/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    await repo.updateRisk(teamId!, id!, stripUndefined(parse(riskPatchBody, req.body)));
    await log(teamId!, u.id, 'risk', 'updated a risk');
    changed(teamId!);
    return { ok: true };
  });

  app.delete('/api/teams/:teamId/risks/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.deleteRisk(teamId!, id!);
    changed(teamId!);
    return { ok: true };
  });

  // ------------------------------------------------------------ activity

  app.get('/api/teams/:teamId/activity', async (req) => {
    const { teamId } = req.params as Params;
    await member(req, teamId!, 'read');
    const filter = parse(activityQuery, req.query);
    return { entries: await listActivity(repo.db, teamId!, filter), names: await teamNames(teamId!) };
  });

  app.get('/api/teams/:teamId/activity/summary', async (req) => {
    const { teamId } = req.params as Params;
    await member(req, teamId!, 'read');
    const counts = await activityCounts(repo.db, [teamId!]);
    return { counts: counts.map(({ userId, kind, n, last }) => ({ userId, kind, n, last })), names: await teamNames(teamId!) };
  });

  app.get('/api/teams/:teamId/activity.csv', async (req) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!, 'read');
    const team = await repo.team(teamId!, role);
    const entries = await listActivity(repo.db, teamId!, { ...parse(activityQuery, req.query), limit: 100_000 });
    const names = await teamNames(teamId!);
    const usernames = Object.fromEntries(team.members.map((m) => [m.userId, m.gitlabUsername ?? '']));
    const rows = [['time (UTC)', 'person', 'gitlab_username', 'source', 'area', 'what', 'link']];
    for (const e of entries.reverse()) rows.push([e.at.replace('T', ' ').slice(0, 19), e.userId ? (names[e.userId] ?? 'Former member') : '', e.userId ? (usernames[e.userId] ?? '') : '', e.source, ACTIVITY_KIND_NAMES[e.kind] ?? e.kind, e.summary, e.url]);
    return new FileResponse(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'text/csv; charset=utf-8', `${slug(team.name)}-activity.csv`);
  });

  /** Names of everyone who appears in a team's activity, including people who left. */
  async function teamNames(teamId: string): Promise<Record<string, string>> {
    const ids = await repo.db.selectFrom('activity').select('user_id').distinct().where('team_id', '=', teamId).where('user_id', 'is not', null).execute();
    return repo.userNames(ids.map((r) => r.user_id!));
  }

  // ------------------------------------------------------------ classes (teaching staff)

  app.get('/api/classes', async (req) => {
    const u = await user(req);
    return { classes: await classes.forUser(u.id) };
  });

  app.post('/api/classes', strictLimit, async (req) => {
    const u = await user(req);
    return { classId: await classes.create(u.id, parse(createClassBody, req.body).name) };
  });

  app.get('/api/classes/:classId', async (req) => {
    const u = await user(req);
    return classes.get((req.params as Params).classId!, u.id);
  });

  app.patch('/api/classes/:classId', async (req) => {
    const u = await user(req);
    const { classId } = req.params as Params;
    await classes.update(classId!, u.id, stripUndefined(parse(updateClassBody, req.body)));
    for (const t of await classTeamIds(classId!)) changed(t);
    return { ok: true };
  });

  app.delete('/api/classes/:classId', async (req) => {
    const u = await user(req);
    const { classId } = req.params as Params;
    const before = await classTeamIds(classId!);
    const deleted = await classes.remove(classId!, u.id);
    for (const t of deleted) realtime.forgetTeam(t);
    for (const t of before) changed(t);
    return { ok: true, deletedTeams: deleted.length };
  });

  app.post('/api/classes/:classId/teams', async (req) => {
    const u = await user(req);
    const { classId } = req.params as Params;
    return { teamIds: await classes.addTeams(classId!, u.id, parse(classTeamsBody, req.body).names) };
  });

  app.post('/api/classes/:classId/staff-code', async (req) => {
    const u = await user(req);
    return { staffCode: await classes.regenerateStaffCode((req.params as Params).classId!, u.id) };
  });

  app.delete('/api/classes/:classId/staff/:userId', async (req) => {
    const u = await user(req);
    const { classId, userId } = req.params as Params;
    await classes.removeStaff(classId!, u.id, userId!);
    for (const t of await classTeamIds(classId!)) realtime.revoke(t, userId!);
    return { ok: true };
  });

  app.post('/api/classes/join-staff', strictLimit, async (req) => {
    const u = await user(req);
    return { classId: await classes.joinAsStaff(parse(joinStaffBody, req.body).code, u.id) };
  });

  /** Activity per student and area across a class, as a spreadsheet. */
  app.get('/api/classes/:classId/activity.csv', async (req) => {
    const u = await user(req);
    const { classId } = req.params as Params;
    const cls = await classes.get(classId!, u.id);
    const counts = await activityCounts(repo.db, cls.teams.map((t) => t.id));
    const kinds = Object.keys(ACTIVITY_KIND_NAMES) as (keyof typeof ACTIVITY_KIND_NAMES)[];
    const rows = [['team', 'person', 'gitlab_username', 'still_in_team', 'total', 'last_activity_utc', ...kinds.map((k) => ACTIVITY_KIND_NAMES[k])]];
    for (const t of cls.teams) {
      const ids = new Set<string>([...t.members.map((m) => m.userId), ...counts.filter((c) => c.teamId === t.id && c.userId).map((c) => c.userId!)]);
      const names = await repo.userNames([...ids]);
      for (const id of ids) {
        const mine = counts.filter((c) => c.teamId === t.id && c.userId === id);
        const memberRow = t.members.find((m) => m.userId === id);
        const last = mine.reduce((a, c) => (c.last > a ? c.last : a), '');
        rows.push([t.name, names[id] ?? 'Former member', memberRow?.gitlabUsername ?? '', memberRow ? 'yes' : 'no', String(mine.reduce((a, c) => a + c.n, 0)), last.replace('T', ' ').slice(0, 19), ...kinds.map((k) => String(mine.find((c) => c.kind === k)?.n ?? 0))]);
      }
    }
    return new FileResponse(rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'text/csv; charset=utf-8', `${slug(cls.name)}-activity-summary.csv`);
  });

  async function classTeamIds(classId: string): Promise<string[]> {
    return (await repo.db.selectFrom('teams').select('id').where('class_id', '=', classId).execute()).map((r) => r.id);
  }

  // ------------------------------------------------------------ meetings

  app.post('/api/teams/:teamId/meetings', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const body = parse(createMeetingBody, req.body);
    const meetingId = await meetings.create(teamId!, u.id, body);
    await log(teamId!, u.id, 'event', `started ${MEETING_INFO[body.kind].name}${body.title ? ` ${q(body.title)}` : ''}`);
    return { meetingId };
  });

  app.get('/api/teams/:teamId/meetings/:id/summary.md', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!, 'read');
    if ((await meetings.teamOf(id!)) !== teamId) throw notFound('Meeting not found');
    const { filename, markdown } = await meetings.summaryMarkdown(id!);
    return new FileResponse(markdown, 'text/markdown; charset=utf-8', filename);
  });

  app.delete('/api/teams/:teamId/meetings/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u, role } = await member(req, teamId!);
    const runtime = await meetings.load(id!);
    if (runtime.record.teamId !== teamId) throw notFound('Meeting not found');
    if (runtime.record.facilitatorId !== u.id && role !== 'admin') throw forbidden('Only the facilitator or a team admin can delete a meeting.');
    await meetings.remove(id!);
    realtime.forgetMeeting(teamId!, id!);
    changed(teamId!);
    return { ok: true };
  });
}

const CHARTER_NAMES = { agreement: 'working agreement', dor: 'Definition of Ready', dod: 'Definition of Done' } as const;
const STATUS_NAMES: Record<StoryDTO['status'], string> = { backlog: 'the Product Backlog', todo: 'To do', doing: 'In progress', done: 'Done' };

/** A short, human description of a story edit for the activity log. */
async function describeStoryChange(before: StoryDTO, after: StoryDTO, patch: Partial<StoryDTO>): Promise<string> {
  const t = `“${after.title}”`;
  if (patch.sprintId !== undefined && patch.sprintId !== before.sprintId) return after.sprintId ? `added ${t} to the sprint` : `moved ${t} back to the Product Backlog`;
  if (patch.status !== undefined && patch.status !== before.status) return `moved ${t} to ${STATUS_NAMES[after.status]}`;
  if (patch.estimate !== undefined && patch.estimate !== before.estimate) return after.estimate ? `estimated ${t} at ${after.estimate}` : `cleared the estimate of ${t}`;
  const parts: string[] = [];
  if (patch.title !== undefined && patch.title !== before.title) parts.push('title');
  if ((['asA', 'iWant', 'soThat'] as const).some((k) => patch[k] !== undefined && patch[k] !== before[k])) parts.push('user story');
  if (patch.acceptanceCriteria && JSON.stringify(patch.acceptanceCriteria) !== JSON.stringify(before.acceptanceCriteria)) parts.push('acceptance criteria');
  if (patch.invest && JSON.stringify(patch.invest) !== JSON.stringify(before.invest)) parts.push('INVEST check');
  if (patch.dor && JSON.stringify(patch.dor) !== JSON.stringify(before.dor)) parts.push('Definition of Ready');
  if (patch.tasks && JSON.stringify(patch.tasks) !== JSON.stringify(before.tasks)) parts.push('tasks');
  if (patch.ownerId !== undefined && patch.ownerId !== before.ownerId) parts.push('owner');
  if (patch.notes !== undefined && patch.notes !== before.notes) parts.push('notes');
  if (patch.kind !== undefined && patch.kind !== before.kind) parts.push('type');
  return parts.length ? `edited ${t} (${parts.join(', ')})` : '';
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'team';
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
