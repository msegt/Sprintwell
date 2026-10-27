import {
  LIMITS,
  storySentence,
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
  deviceLinkRedeemBody,
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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import type { Config } from '../config';
import type { MeetingManager } from '../meetings/manager';
import type { Hub } from '../realtime/hub';
import type { Repo } from '../repo';
import { HttpError, badRequest, forbidden, notFound } from '../util';

export interface Deps {
  repo: Repo;
  hub: Hub;
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

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

type Params = Record<string, string>;

export function registerApi(app: FastifyInstance, deps: Deps): void {
  const { repo, hub, meetings, config } = deps;

  async function user(req: FastifyRequest): Promise<UserDTO> {
    const token = bearer(req);
    const u = token ? await repo.userForToken(token) : null;
    if (!u) throw new HttpError(401, 'Please join or create a team first.');
    return u;
  }

  async function member(req: FastifyRequest, teamId: string): Promise<{ user: UserDTO; role: TeamRole }> {
    const u = await user(req);
    const role = await repo.membership(teamId, u.id);
    if (!role) throw notFound('Team not found');
    return { user: u, role };
  }

  async function admin(req: FastifyRequest, teamId: string) {
    const m = await member(req, teamId);
    if (m.role !== 'admin') throw forbidden('Only team admins can do that.');
    return m;
  }

  const changed = (teamId: string) => hub.notifyTeam(teamId);
  const strictLimit = { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  // ------------------------------------------------------------ public

  app.get('/api/config', async () => ({
    appName: 'Sprintwell',
    version: config.version,
    donationUrl: config.donationUrl,
    sourceUrl: config.sourceUrl,
  }));

  app.get('/api/invites/:code', strictLimit, async (req) => {
    const { code } = req.params as Params;
    const preview = await repo.invitePreview(code ?? '');
    if (!preview) throw notFound('That invite link is not valid any more. Ask your team for a new one.');
    return { teamName: preview.teamName, memberCount: preview.memberCount };
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

  app.get('/api/me/export', async (req, reply) => {
    const u = await user(req);
    const teams = await repo.teamsForUser(u.id);
    reply.header('content-disposition', 'attachment; filename="sprintwell-my-data.json"');
    return { exportedAt: new Date().toISOString(), user: u, teams };
  });

  app.delete('/api/me', async (req) => {
    const u = await user(req);
    const teams = await repo.deleteUser(u.id);
    for (const t of teams) {
      hub.revoke(t, u.id);
      if (!(await repo.teamExists(t))) meetings.forgetTeam(t);
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
    const teamId = await repo.joinTeam(code, u.id);
    changed(teamId);
    return { teamId };
  });

  app.get('/api/teams/:teamId', async (req) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!);
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
    meetings.forgetTeam(teamId!);
    changed(teamId!);
    for (const m of members) hub.revoke(teamId!, m.userId);
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
    const m = await member(req, teamId!);
    if (m.user.id !== userId && m.role !== 'admin') throw forbidden('Only team admins can remove other people.');
    await repo.removeMember(teamId!, userId!);
    hub.revoke(teamId!, userId!);
    let inviteRotated = false;
    if (!(await repo.teamExists(teamId!))) {
      meetings.forgetTeam(teamId!);
    } else if (m.user.id !== userId) {
      // Stop the removed person rejoining with the link they already have.
      await repo.regenerateInvite(teamId!);
      inviteRotated = true;
    }
    changed(teamId!);
    return { ok: true, inviteRotated };
  });

  app.get('/api/teams/:teamId/export.json', async (req, reply) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!);
    const snap = await repo.snapshot(teamId!, role);
    const summaries = [];
    for (const m of snap.meetings) summaries.push({ ...m, summaryMarkdown: (await meetings.summaryMarkdown(m.id)).markdown });
    const { inviteCode: _omit, ...team } = snap.team;
    reply.header('content-disposition', `attachment; filename="sprintwell-${slug(snap.team.name)}.json"`);
    return { format: 'sprintwell-export', version: 1, exportedAt: new Date().toISOString(), ...snap, team, meetings: summaries };
  });

  app.get('/api/teams/:teamId/stories.csv', async (req, reply) => {
    const { teamId } = req.params as Params;
    const { role } = await member(req, teamId!);
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
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${slug(snap.team.name)}-stories.csv"`);
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  });

  // ------------------------------------------------------------ charter

  app.post('/api/teams/:teamId/charter', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const body = parse(charterItemBody, req.body);
    const item = await repo.addCharterItem(teamId!, u.id, body.kind, body.text);
    changed(teamId!);
    return item;
  });

  app.patch('/api/teams/:teamId/charter/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    await repo.updateCharterItem(teamId!, id!, u.id, parse(charterUpdateBody, req.body).text);
    changed(teamId!);
    return { ok: true };
  });

  app.delete('/api/teams/:teamId/charter/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.deleteCharterItem(teamId!, id!);
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
    await member(req, teamId!);
    const [story] = await repo.createStories(teamId!, [parse(storyBody, req.body)]);
    changed(teamId!);
    return story;
  });

  app.post('/api/teams/:teamId/stories/bulk', async (req) => {
    const { teamId } = req.params as Params;
    await member(req, teamId!);
    const { stories } = parse(bulkStoriesBody, req.body);
    const created = await repo.createStories(
      teamId!,
      stories.map((s) => ({ ...parse(storyBody, { title: s.title, notes: s.notes, externalUrl: s.externalUrl, estimate: s.estimate }) })),
    );
    changed(teamId!);
    return { created: created.length };
  });

  app.patch('/api/teams/:teamId/stories/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    const story = await repo.updateStory(teamId!, id!, stripUndefined(parse(storyPatchBody, req.body)));
    changed(teamId!);
    return story;
  });

  app.delete('/api/teams/:teamId/stories/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.deleteStory(teamId!, id!);
    changed(teamId!);
    return { ok: true };
  });

  app.post('/api/teams/:teamId/stories/reorder', async (req) => {
    const { teamId } = req.params as Params;
    await member(req, teamId!);
    await repo.reorder('stories', teamId!, parse(reorderBody, req.body).ids);
    changed(teamId!);
    return { ok: true };
  });

  // ------------------------------------------------------------ sprints

  app.post('/api/teams/:teamId/sprints', async (req) => {
    const { teamId } = req.params as Params;
    await member(req, teamId!);
    const sprint = await repo.createSprint(teamId!, parse(sprintBody, req.body));
    changed(teamId!);
    return sprint;
  });

  app.patch('/api/teams/:teamId/sprints/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.updateSprint(teamId!, id!, stripUndefined(parse(sprintPatchBody, req.body)));
    changed(teamId!);
    return { ok: true };
  });

  app.post('/api/teams/:teamId/sprints/:id/close', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    const result = await repo.closeSprint(teamId!, id!);
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
    await member(req, teamId!);
    const body = parse(actionBody, req.body);
    const meetingId = typeof (req.body as { meetingId?: unknown })?.meetingId === 'string' ? (req.body as { meetingId: string }).meetingId : null;
    if (meetingId && (await meetings.teamOf(meetingId).catch(() => null)) !== teamId) throw badRequest('Unknown meeting');
    const action = await repo.createAction(teamId!, { ...body, meetingId });
    changed(teamId!);
    return action;
  });

  app.patch('/api/teams/:teamId/actions/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.updateAction(teamId!, id!, stripUndefined(parse(actionPatchBody, req.body)));
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
    await member(req, teamId!);
    const risk = await repo.createRisk(teamId!, parse(riskBody, req.body));
    changed(teamId!);
    return risk;
  });

  app.patch('/api/teams/:teamId/risks/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    await repo.updateRisk(teamId!, id!, stripUndefined(parse(riskPatchBody, req.body)));
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

  // ------------------------------------------------------------ meetings

  app.post('/api/teams/:teamId/meetings', async (req) => {
    const { teamId } = req.params as Params;
    const { user: u } = await member(req, teamId!);
    const body = parse(createMeetingBody, req.body);
    const meetingId = await meetings.create(teamId!, u.id, body);
    return { meetingId };
  });

  app.get('/api/teams/:teamId/meetings/:id/summary.md', async (req, reply: FastifyReply) => {
    const { teamId, id } = req.params as Params;
    await member(req, teamId!);
    if ((await meetings.teamOf(id!)) !== teamId) throw notFound('Meeting not found');
    const { filename, markdown } = await meetings.summaryMarkdown(id!);
    reply.header('content-type', 'text/markdown; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return markdown;
  });

  app.delete('/api/teams/:teamId/meetings/:id', async (req) => {
    const { teamId, id } = req.params as Params;
    const { user: u, role } = await member(req, teamId!);
    const runtime = await meetings.load(id!);
    if (runtime.record.teamId !== teamId) throw notFound('Meeting not found');
    if (runtime.record.facilitatorId !== u.id && role !== 'admin') throw forbidden('Only the facilitator or a team admin can delete a meeting.');
    await meetings.remove(id!);
    changed(teamId!);
    return { ok: true };
  });
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
