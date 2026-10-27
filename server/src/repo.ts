import {
  DEFAULT_CLASS_SETTINGS,
  DEFAULT_TEAM_SETTINGS,
  LIMITS,
  STARTER_AGREEMENT,
  STARTER_DOD,
  STARTER_DOR,
  type ActionDTO,
  type CapacityRow,
  type ClassSettings,
  type CharterItemDTO,
  type CharterKind,
  readinessProblems,
  type MeetingKind,
  type MeetingSummaryDTO,
  type MemberDTO,
  type RiskDTO,
  type SprintDTO,
  type StoryDTO,
  type TeamDTO,
  type TeamRole,
  type TeamSettings,
  type TeamSnapshot,
  type TeamSummaryDTO,
  type UserDTO,
} from '@sprintwell/shared';
import { sql, type Insertable, type Selectable } from 'kysely';
import type { Db } from './db';
import type {
  Database,
  ActionsTable,
  CharterItemsTable,
  MeetingsTable,
  RisksTable,
  SprintsTable,
  StoriesTable,
  UsersTable,
} from './db/schema';
import { HttpError, badRequest, forbidden, hashToken, newDeviceCode, newId, newInviteCode, newToken, notFound, now, parseJson } from './util';

export const FORMER_MEMBER = 'Former member';

export function toUser(row: Selectable<UsersTable>, gitlab: { username: string; name: string; scopes: string } | null = null): UserDTO {
  return {
    id: row.id,
    displayName: row.display_name,
    hasEmail: !!row.email,
    gitlab: gitlab ? { username: gitlab.username, name: gitlab.name, canUseApi: gitlab.scopes.split(/\s+/).includes('api') } : null,
  };
}

export function toCharter(r: Selectable<CharterItemsTable>): CharterItemDTO {
  return { id: r.id, kind: r.kind as CharterKind, text: r.text, position: Number(r.position), updatedAt: r.updated_at, updatedBy: r.updated_by };
}

export function toSprint(r: Selectable<SprintsTable>): SprintDTO {
  return {
    id: r.id,
    name: r.name,
    goal: r.goal,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status as SprintDTO['status'],
    goalMet: (r.goal_met as SprintDTO['goalMet']) ?? null,
    capacity: parseJson<CapacityRow[]>(r.capacity, []),
    createdAt: r.created_at,
    closedAt: r.closed_at,
  };
}

export function toStory(r: Selectable<StoriesTable>): StoryDTO {
  return {
    id: r.id,
    sprintId: r.sprint_id,
    kind: (r.kind || 'story') as StoryDTO['kind'],
    title: r.title,
    asA: r.as_a,
    iWant: r.i_want,
    soThat: r.so_that,
    acceptanceCriteria: parseJson(r.acceptance_criteria, []),
    notes: r.notes,
    estimate: r.estimate,
    status: r.status as StoryDTO['status'],
    invest: parseJson(r.invest, {}),
    dor: parseJson(r.dor, {}),
    externalUrl: r.external_url,
    tasks: parseJson(r.tasks, []),
    ownerId: r.owner_id,
    position: Number(r.position),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    doneAt: r.done_at,
    gitlabIid: r.gitlab_iid === null || r.gitlab_iid === undefined ? null : Number(r.gitlab_iid),
  };
}

export function toAction(r: Selectable<ActionsTable>): ActionDTO {
  return {
    id: r.id,
    kind: r.kind as ActionDTO['kind'],
    text: r.text,
    ownerId: r.owner_id,
    dueDate: r.due_date,
    status: r.status as ActionDTO['status'],
    meetingId: r.meeting_id,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export function toRisk(r: Selectable<RisksTable>): RiskDTO {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category as RiskDTO['category'],
    likelihood: Number(r.likelihood) as RiskDTO['likelihood'],
    impact: Number(r.impact) as RiskDTO['impact'],
    countermeasure: r.countermeasure,
    ownerId: r.owner_id,
    status: r.status as RiskDTO['status'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toMeetingSummary(r: Pick<Selectable<MeetingsTable>, 'id' | 'kind' | 'title' | 'sprint_id' | 'facilitator_id' | 'phase' | 'created_at' | 'ended_at'>): MeetingSummaryDTO {
  return {
    id: r.id,
    kind: r.kind as MeetingKind,
    title: r.title,
    sprintId: r.sprint_id,
    facilitatorId: r.facilitator_id,
    phase: r.phase,
    createdAt: r.created_at,
    endedAt: r.ended_at,
  };
}

type TeamTable = 'charter_items' | 'sprints' | 'stories' | 'actions' | 'risks' | 'meetings';

/** Data access. Every team-scoped method filters by team id to prevent cross-team access. */
export class Repo {
  constructor(
    readonly db: Db,
    /** Cloudflare D1 has no interactive transactions; there, grouped writes run in sequence. */
    private readonly options: { transactions: boolean } = { transactions: true },
  ) {}

  private tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return this.options.transactions ? this.db.transaction().execute(fn) : fn(this.db);
  }

  /** Inserts rows in chunks that stay under D1's limit of 100 bound parameters per query. */
  private async insertMany<T extends 'charter_items' | 'stories'>(db: Db, table: T, rows: Insertable<Database[T]>[]): Promise<void> {
    if (rows.length === 0) return;
    const per = Math.max(1, Math.floor(90 / Object.keys(rows[0]!).length));
    for (let i = 0; i < rows.length; i += per) {
      await db.insertInto(table).values(rows.slice(i, i + per) as never).execute();
    }
  }

  /** Rejects writes that would take a team past a size limit. */
  async assertRoom(table: TeamTable, teamId: string, adding: number, max: number, what: string): Promise<void> {
    const row = await this.db.selectFrom(table).select((e) => e.fn.countAll<number>().as('n')).where('team_id', '=', teamId).executeTakeFirstOrThrow();
    if (Number(row.n) + adding > max) throw badRequest(`This team has reached the limit of ${max} ${what}.`);
  }

  /** Rejects user ids that are not current members of the team (owners, assignees). */
  async assertMembers(teamId: string, ids: (string | null | undefined)[]): Promise<void> {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    let found = 0;
    for (const part of chunks(wanted, 90)) {
      const rows = await this.db.selectFrom('memberships').select('user_id').where('team_id', '=', teamId).where('user_id', 'in', part).execute();
      found += rows.length;
    }
    if (found !== wanted.length) throw badRequest('Owners must be members of the team.');
  }

  // ---------------------------------------------------------------- users

  async createUser(displayName: string): Promise<{ user: UserDTO; token: string }> {
    const id = newId();
    const ts = now();
    await this.db.insertInto('users').values({ id, display_name: displayName, email: null, created_at: ts, deleted_at: null }).execute();
    const token = await this.createSession(id);
    return { user: { id, displayName, hasEmail: false, gitlab: null }, token };
  }

  async createSession(userId: string): Promise<string> {
    const token = newToken();
    const ts = now();
    await this.db.insertInto('sessions').values({ id: newId(), user_id: userId, token_hash: hashToken(token), created_at: ts, last_seen_at: ts }).execute();
    return token;
  }

  async userForToken(token: string): Promise<UserDTO | null> {
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .leftJoin('gitlab_accounts as g', 'g.user_id', 'users.id')
      .select(['users.id', 'users.display_name', 'users.email', 'users.created_at', 'users.deleted_at', 'sessions.id as session_id', 'sessions.last_seen_at', 'g.username', 'g.name', 'g.scopes'])
      .where('sessions.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (!row || row.deleted_at) return null;
    // Touch at most hourly to avoid a write per request.
    if (Date.now() - Date.parse(row.last_seen_at) > 3_600_000) {
      await this.db.updateTable('sessions').set({ last_seen_at: now() }).where('id', '=', row.session_id).execute();
    }
    return toUser(row, row.username ? { username: row.username, name: row.name ?? row.username, scopes: row.scopes ?? '' } : null);
  }

  async userById(userId: string): Promise<UserDTO | null> {
    const row = await this.db
      .selectFrom('users')
      .leftJoin('gitlab_accounts as g', 'g.user_id', 'users.id')
      .select(['users.id', 'users.display_name', 'users.email', 'users.created_at', 'users.deleted_at', 'g.username', 'g.name', 'g.scopes'])
      .where('users.id', '=', userId)
      .executeTakeFirst();
    if (!row || row.deleted_at) return null;
    return toUser(row, row.username ? { username: row.username, name: row.name ?? row.username, scopes: row.scopes ?? '' } : null);
  }

  async deleteSession(token: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('token_hash', '=', hashToken(token)).execute();
  }

  async renameUser(userId: string, displayName: string): Promise<void> {
    await this.db.updateTable('users').set({ display_name: displayName }).where('id', '=', userId).execute();
  }

  async createDeviceLink(userId: string): Promise<{ code: string; expiresAt: string }> {
    const code = newDeviceCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await this.db.deleteFrom('device_links').where('expires_at', '<', now()).execute();
    await this.db.insertInto('device_links').values({ code_hash: hashToken(code), user_id: userId, expires_at: expiresAt }).execute();
    return { code, expiresAt };
  }

  async redeemDeviceLink(code: string): Promise<{ user: UserDTO; token: string } | null> {
    const hash = hashToken(code.trim().toUpperCase());
    const link = await this.db.selectFrom('device_links').selectAll().where('code_hash', '=', hash).executeTakeFirst();
    if (!link) return null;
    await this.db.deleteFrom('device_links').where('code_hash', '=', hash).execute();
    if (link.expires_at < now()) return null;
    const user = await this.db.selectFrom('users').selectAll().where('id', '=', link.user_id).executeTakeFirst();
    if (!user || user.deleted_at) return null;
    return { user: (await this.userById(user.id))!, token: await this.createSession(user.id) };
  }

  /**
   * Erases a person: removes them from every team (handing admin rights on when
   * needed), deletes their sessions and replaces their name. Team history such as
   * retrospective cards stays with the team but is no longer attributable.
   */
  async deleteUser(userId: string): Promise<string[]> {
    const memberships = await this.db.selectFrom('memberships').select('team_id').where('user_id', '=', userId).execute();
    const affected: string[] = [];
    for (const m of memberships) {
      await this.removeMember(m.team_id, userId);
      affected.push(m.team_id);
    }
    await this.db.deleteFrom('sessions').where('user_id', '=', userId).execute();
    await this.db.deleteFrom('device_links').where('user_id', '=', userId).execute();
    await this.db.deleteFrom('gitlab_accounts').where('user_id', '=', userId).execute();
    await this.db.updateTable('users').set({ display_name: FORMER_MEMBER, email: null, deleted_at: now() }).where('id', '=', userId).execute();
    return affected;
  }

  // ---------------------------------------------------------------- teams

  /** Creates a team. With a class, the creator (teaching staff) is not a member: the first student to join becomes its admin. */
  async createTeam(userId: string, name: string, starterCharter: boolean, classId: string | null = null): Promise<string> {
    const id = newId();
    const ts = now();
    await this.tx(async (trx) => {
      await trx
        .insertInto('teams')
        .values({ id, name, invite_code: newInviteCode(), settings: JSON.stringify(DEFAULT_TEAM_SETTINGS), created_at: ts, created_by: userId, class_id: classId })
        .execute();
      if (!classId) await trx.insertInto('memberships').values({ team_id: id, user_id: userId, role: 'admin', joined_at: ts }).execute();
      if (starterCharter) {
        const rows = [
          ...STARTER_AGREEMENT.map((text, i) => ({ kind: 'agreement', text, position: i })),
          ...STARTER_DOR.map((text, i) => ({ kind: 'dor', text, position: i })),
          ...STARTER_DOD.map((text, i) => ({ kind: 'dod', text, position: i })),
        ].map((r) => ({ ...r, id: newId(), team_id: id, updated_at: ts, updated_by: null }));
        await this.insertMany(trx, 'charter_items', rows);
      }
    });
    return id;
  }

  async teamsForUser(userId: string): Promise<TeamSummaryDTO[]> {
    const rows = await this.db
      .selectFrom('memberships as m')
      .innerJoin('teams as t', 't.id', 'm.team_id')
      .select(['t.id', 't.name', 'm.role'])
      .select((eb) =>
        eb.selectFrom('memberships as m2').whereRef('m2.team_id', '=', 't.id').select((e) => e.fn.countAll<number>().as('n')).as('member_count'),
      )
      .where('m.user_id', '=', userId)
      .orderBy('t.name')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role as TeamRole, memberCount: Number(r.member_count ?? 0) }));
  }

  async membership(teamId: string, userId: string): Promise<TeamRole | null> {
    const row = await this.db.selectFrom('memberships').select('role').where('team_id', '=', teamId).where('user_id', '=', userId).executeTakeFirst();
    return (row?.role as TeamRole) ?? null;
  }

  /** Membership role, or 'coach' for teaching staff of the team's class. */
  async access(teamId: string, userId: string): Promise<TeamRole | null> {
    const role = await this.membership(teamId, userId);
    if (role) return role;
    const staff = await this.db
      .selectFrom('teams as t')
      .innerJoin('class_staff as cs', 'cs.class_id', 't.class_id')
      .select('cs.role')
      .where('t.id', '=', teamId)
      .where('cs.user_id', '=', userId)
      .executeTakeFirst();
    return staff ? 'coach' : null;
  }

  private async classOfTeam(teamId: string): Promise<{ id: string; name: string; settings: ClassSettings } | null> {
    const row = await this.db
      .selectFrom('teams as t')
      .innerJoin('classes as c', 'c.id', 't.class_id')
      .select(['c.id', 'c.name', 'c.settings'])
      .where('t.id', '=', teamId)
      .executeTakeFirst();
    return row ? { id: row.id, name: row.name, settings: { ...DEFAULT_CLASS_SETTINGS, ...parseJson<Partial<ClassSettings>>(row.settings, {}) } } : null;
  }

  async invitePreview(code: string): Promise<{ teamId: string; teamName: string; memberCount: number } | null> {
    const team = await this.db.selectFrom('teams').select(['id', 'name']).where('invite_code', '=', code.trim().toLowerCase()).executeTakeFirst();
    if (!team) return null;
    const count = await this.db.selectFrom('memberships').select((e) => e.fn.countAll<number>().as('n')).where('team_id', '=', team.id).executeTakeFirstOrThrow();
    return { teamId: team.id, teamName: team.name, memberCount: Number(count.n) };
  }

  async joinTeam(code: string, userId: string): Promise<string> {
    const preview = await this.invitePreview(code);
    if (!preview) throw notFound('That invite link is not valid any more. Ask your team for a new one.');
    const existing = await this.membership(preview.teamId, userId);
    if (!existing) {
      if (preview.memberCount >= 100) throw badRequest('This team is full (100 members).');
      const cls = await this.classOfTeam(preview.teamId);
      if (cls) {
        if (cls.settings.requireGitlab) {
          const linked = await this.db.selectFrom('gitlab_accounts').select('user_id').where('user_id', '=', userId).executeTakeFirst();
          if (!linked) throw new HttpError(403, `${cls.name} asks everyone to sign in with GitLab before joining a team.`, { code: 'gitlab_required' });
        }
        const other = await this.db
          .selectFrom('memberships as m')
          .innerJoin('teams as t', 't.id', 'm.team_id')
          .select('t.name')
          .where('m.user_id', '=', userId)
          .where('t.class_id', '=', cls.id)
          .executeTakeFirst();
        if (other) throw badRequest(`You are already in ${other.name} in ${cls.name}. Ask your teacher if you need to change team.`);
      }
      const hasAdmin = await this.db.selectFrom('memberships').select('user_id').where('team_id', '=', preview.teamId).where('role', '=', 'admin').executeTakeFirst();
      await this.db.insertInto('memberships').values({ team_id: preview.teamId, user_id: userId, role: hasAdmin ? 'member' : 'admin', joined_at: now() }).execute();
    }
    return preview.teamId;
  }

  async regenerateInvite(teamId: string): Promise<string> {
    const code = newInviteCode();
    await this.db.updateTable('teams').set({ invite_code: code }).where('id', '=', teamId).execute();
    return code;
  }

  async updateTeam(teamId: string, patch: { name?: string; settings?: Partial<TeamSettings> }): Promise<void> {
    const team = await this.db.selectFrom('teams').select('settings').where('id', '=', teamId).executeTakeFirst();
    if (!team) throw notFound();
    const settings = { ...DEFAULT_TEAM_SETTINGS, ...parseJson<Partial<TeamSettings>>(team.settings, {}), ...(patch.settings ?? {}) };
    // Class teams always keep the Definition of Ready gate.
    if (await this.classOfTeam(teamId)) settings.enforceReady = true;
    await this.db
      .updateTable('teams')
      .set({ ...(patch.name ? { name: patch.name } : {}), settings: JSON.stringify(settings) })
      .where('id', '=', teamId)
      .execute();
  }

  async deleteTeam(teamId: string): Promise<void> {
    await this.db.deleteFrom('teams').where('id', '=', teamId).execute();
  }

  async setRole(teamId: string, userId: string, role: TeamRole): Promise<void> {
    if (role === 'member') await this.assertNotLastAdmin(teamId, userId);
    const res = await this.db.updateTable('memberships').set({ role }).where('team_id', '=', teamId).where('user_id', '=', userId).executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw notFound('Member not found');
  }

  private async assertNotLastAdmin(teamId: string, userId: string): Promise<void> {
    const admins = await this.db.selectFrom('memberships').select('user_id').where('team_id', '=', teamId).where('role', '=', 'admin').execute();
    if (admins.length === 1 && admins[0]!.user_id === userId) {
      throw forbidden('A team needs at least one admin. Make someone else an admin first.');
    }
  }

  /** Removes a member. If they were the last admin, the longest-standing member becomes admin; an empty team is deleted. */
  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.tx(async (trx) => {
      const role = await trx.selectFrom('memberships').select('role').where('team_id', '=', teamId).where('user_id', '=', userId).executeTakeFirst();
      if (!role) throw notFound('Member not found');
      await trx.deleteFrom('memberships').where('team_id', '=', teamId).where('user_id', '=', userId).execute();
      const remaining = await trx.selectFrom('memberships').select(['user_id', 'role']).where('team_id', '=', teamId).orderBy('joined_at').execute();
      const inClass = await trx.selectFrom('teams').select('class_id').where('id', '=', teamId).executeTakeFirst();
      if (remaining.length === 0 && !inClass?.class_id) {
        await trx.deleteFrom('teams').where('id', '=', teamId).execute();
      } else if (remaining.length > 0 && !remaining.some((m) => m.role === 'admin')) {
        await trx.updateTable('memberships').set({ role: 'admin' }).where('team_id', '=', teamId).where('user_id', '=', remaining[0]!.user_id).execute();
      }
    });
  }

  async teamExists(teamId: string): Promise<boolean> {
    return !!(await this.db.selectFrom('teams').select('id').where('id', '=', teamId).executeTakeFirst());
  }

  async team(teamId: string, viewerRole: TeamRole): Promise<TeamDTO> {
    const t = await this.db.selectFrom('teams').selectAll().where('id', '=', teamId).executeTakeFirst();
    if (!t) throw notFound('Team not found');
    const members = await this.members(teamId);
    const cls = t.class_id ? await this.classOfTeam(teamId) : null;
    const gl = await this.db.selectFrom('team_gitlab').select(['path', 'web_url', 'last_sync_at', 'estimate_field']).where('team_id', '=', teamId).executeTakeFirst();
    const settings = { ...DEFAULT_TEAM_SETTINGS, ...parseJson<Partial<TeamSettings>>(t.settings, {}) };
    if (cls) settings.enforceReady = true;
    return {
      id: t.id,
      name: t.name,
      inviteCode: t.invite_code,
      createdAt: t.created_at,
      settings,
      members,
      myRole: viewerRole,
      classInfo: cls ? { id: cls.id, name: cls.name, requireGitlab: cls.settings.requireGitlab, resources: cls.settings.resources } : null,
      gitlab: gl ? { path: gl.path, webUrl: gl.web_url, lastSyncAt: gl.last_sync_at, estimateField: gl.estimate_field as 'weight' | 'label' | 'unknown' } : null,
    };
  }

  async members(teamId: string): Promise<MemberDTO[]> {
    const rows = await this.db
      .selectFrom('memberships as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .leftJoin('gitlab_accounts as g', 'g.user_id', 'u.id')
      .select(['u.id', 'u.display_name', 'm.role', 'm.joined_at', 'g.username'])
      .where('m.team_id', '=', teamId)
      .orderBy('m.joined_at')
      .execute();
    return rows.map((r) => ({ userId: r.id, displayName: r.display_name, role: r.role as TeamRole, joinedAt: r.joined_at, gitlabUsername: r.username ?? null }));
  }

  /** Names for everyone who ever appeared in the team's data, including people who left. */
  async userNames(ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const part of chunks([...new Set(ids)], 90)) {
      const rows = await this.db.selectFrom('users').select(['id', 'display_name']).where('id', 'in', part).execute();
      for (const r of rows) out[r.id] = r.display_name;
    }
    return out;
  }

  async snapshot(teamId: string, viewerRole: TeamRole): Promise<TeamSnapshot> {
    const [team, charter, sprints, stories, actions, risks, meetings] = await Promise.all([
      this.team(teamId, viewerRole),
      this.db.selectFrom('charter_items').selectAll().where('team_id', '=', teamId).orderBy('kind').orderBy('position').execute(),
      this.db.selectFrom('sprints').selectAll().where('team_id', '=', teamId).orderBy('created_at', 'desc').execute(),
      this.db.selectFrom('stories').selectAll().where('team_id', '=', teamId).orderBy('position').execute(),
      this.db.selectFrom('actions').selectAll().where('team_id', '=', teamId).orderBy('created_at', 'desc').execute(),
      this.db.selectFrom('risks').selectAll().where('team_id', '=', teamId).orderBy('created_at').execute(),
      this.db
        .selectFrom('meetings')
        .select(['id', 'kind', 'title', 'sprint_id', 'facilitator_id', 'phase', 'created_at', 'ended_at'])
        .where('team_id', '=', teamId)
        .orderBy('created_at', 'desc')
        .limit(200)
        .execute(),
    ]);
    return {
      team,
      charter: charter.map(toCharter),
      sprints: sprints.map(toSprint),
      stories: stories.map(toStory),
      actions: actions.map(toAction),
      risks: risks.map(toRisk),
      meetings: meetings.map(toMeetingSummary),
    };
  }

  // ---------------------------------------------------------------- charter

  async addCharterItem(teamId: string, userId: string, kind: CharterKind, text: string): Promise<CharterItemDTO> {
    await this.assertRoom('charter_items', teamId, 1, LIMITS.charterItemsPerTeam, 'charter items');
    const max = await this.db
      .selectFrom('charter_items')
      .select((e) => e.fn.max<number>('position').as('p'))
      .where('team_id', '=', teamId)
      .where('kind', '=', kind)
      .executeTakeFirst();
    const row = { id: newId(), team_id: teamId, kind, text, position: Number(max?.p ?? -1) + 1, updated_at: now(), updated_by: userId };
    await this.db.insertInto('charter_items').values(row).execute();
    return toCharter(row);
  }

  async updateCharterItem(teamId: string, id: string, userId: string, text: string): Promise<void> {
    const r = await this.db
      .updateTable('charter_items')
      .set({ text, updated_at: now(), updated_by: userId })
      .where('team_id', '=', teamId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound();
  }

  async deleteCharterItem(teamId: string, id: string): Promise<void> {
    await this.db.deleteFrom('charter_items').where('team_id', '=', teamId).where('id', '=', id).execute();
  }

  async reorder(table: 'charter_items' | 'stories', teamId: string, ids: string[]): Promise<void> {
    // One UPDATE … CASE per chunk keeps the number of queries (and D1 subrequests) low.
    await this.tx(async (trx) => {
      for (let start = 0; start < ids.length; start += 30) {
        const part = ids.slice(start, start + 30);
        const cases = sql.join(
          part.map((id, i) => sql`when ${id} then ${start + i}`),
          sql` `,
        );
        await trx
          .updateTable(table)
          .set({ position: sql<number>`case id ${cases} else position end` })
          .where('team_id', '=', teamId)
          .where('id', 'in', part)
          .execute();
      }
    });
  }

  // ---------------------------------------------------------------- sprints

  async createSprint(teamId: string, input: { name: string; goal: string; startDate: string | null; endDate: string | null }): Promise<SprintDTO> {
    await this.assertRoom('sprints', teamId, 1, LIMITS.sprintsPerTeam, 'sprints');
    const row = {
      id: newId(),
      team_id: teamId,
      name: input.name,
      goal: input.goal,
      start_date: input.startDate,
      end_date: input.endDate,
      status: 'planned',
      goal_met: null,
      capacity: '[]',
      created_at: now(),
      closed_at: null,
      gitlab_milestone_id: null,
    };
    await this.db.insertInto('sprints').values(row).execute();
    return toSprint(row);
  }

  async sprint(teamId: string, id: string): Promise<SprintDTO> {
    const row = await this.db.selectFrom('sprints').selectAll().where('team_id', '=', teamId).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Sprint not found');
    return toSprint(row);
  }

  async nextSprintName(teamId: string): Promise<string> {
    const n = await this.db.selectFrom('sprints').select((e) => e.fn.countAll<number>().as('n')).where('team_id', '=', teamId).executeTakeFirstOrThrow();
    return `Sprint ${Number(n.n) + 1}`;
  }

  async updateSprint(
    teamId: string,
    id: string,
    patch: { name?: string; goal?: string; startDate?: string | null; endDate?: string | null; status?: SprintDTO['status']; goalMet?: SprintDTO['goalMet']; capacity?: CapacityRow[] },
  ): Promise<void> {
    await this.sprint(teamId, id);
    if (patch.status === 'active') {
      const other = await this.db
        .selectFrom('sprints')
        .select('name')
        .where('team_id', '=', teamId)
        .where('status', '=', 'active')
        .where('id', '!=', id)
        .executeTakeFirst();
      if (other) throw badRequest(`${other.name} is still active. Close it in a Sprint Review before starting another sprint.`);
    }
    await this.db
      .updateTable('sprints')
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.goal !== undefined && { goal: patch.goal }),
        ...(patch.startDate !== undefined && { start_date: patch.startDate }),
        ...(patch.endDate !== undefined && { end_date: patch.endDate }),
        ...(patch.status !== undefined && { status: patch.status, closed_at: patch.status === 'closed' ? now() : null }),
        ...(patch.goalMet !== undefined && { goal_met: patch.goalMet }),
        ...(patch.capacity !== undefined && { capacity: JSON.stringify(patch.capacity) }),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', id)
      .execute();
  }

  /** Closes a sprint; unfinished stories return to the Product Backlog. */
  async closeSprint(teamId: string, id: string): Promise<{ returned: number }> {
    await this.sprint(teamId, id);
    let returned = 0;
    await this.tx(async (trx) => {
      const r = await trx
        .updateTable('stories')
        .set({ sprint_id: null, status: 'backlog', updated_at: now() })
        .where('team_id', '=', teamId)
        .where('sprint_id', '=', id)
        .where('status', '!=', 'done')
        .executeTakeFirst();
      returned = Number(r.numUpdatedRows);
      await trx.updateTable('sprints').set({ status: 'closed', closed_at: now() }).where('team_id', '=', teamId).where('id', '=', id).execute();
    });
    return { returned };
  }

  async deleteSprint(teamId: string, id: string): Promise<void> {
    await this.tx(async (trx) => {
      await trx.updateTable('stories').set({ sprint_id: null, status: 'backlog' }).where('team_id', '=', teamId).where('sprint_id', '=', id).where('status', '!=', 'done').execute();
      await trx.updateTable('stories').set({ sprint_id: null }).where('team_id', '=', teamId).where('sprint_id', '=', id).execute();
      await trx.deleteFrom('sprints').where('team_id', '=', teamId).where('id', '=', id).execute();
    });
  }

  // ---------------------------------------------------------------- stories

  /**
   * Refuses items that do not meet the team's Definition of Ready (and, for user
   * stories, the story format and INVEST) when they would enter a sprint.
   */
  private async assertReady(teamId: string, items: Pick<StoryDTO, 'title' | 'kind' | 'asA' | 'iWant' | 'soThat' | 'acceptanceCriteria' | 'invest' | 'dor'>[]): Promise<void> {
    if (items.length === 0) return;
    const team = await this.db.selectFrom('teams').select('settings').where('id', '=', teamId).executeTakeFirst();
    const settings = { ...DEFAULT_TEAM_SETTINGS, ...parseJson<Partial<TeamSettings>>(team?.settings, {}) };
    if (!settings.enforceReady) return;
    const charter = (await this.db.selectFrom('charter_items').selectAll().where('team_id', '=', teamId).where('kind', '=', 'dor').execute()).map(toCharter);
    const notReady = items.map((s) => ({ title: s.title, problems: readinessProblems(s, charter) })).filter((x) => x.problems.length > 0);
    if (notReady.length === 0) return;
    const first = notReady[0]!;
    throw new HttpError(
      422,
      notReady.length === 1 ? `“${first.title}” is not ready for a sprint. ${first.problems[0]!.message}` : `${notReady.length} items are not ready for a sprint.`,
      { code: 'not_ready', items: notReady },
    );
  }

  async story(teamId: string, id: string): Promise<StoryDTO> {
    const row = await this.db.selectFrom('stories').selectAll().where('team_id', '=', teamId).where('id', '=', id).executeTakeFirst();
    if (!row) throw notFound('Story not found');
    return toStory(row);
  }

  async storiesByIds(teamId: string, ids: string[]): Promise<StoryDTO[]> {
    const byId = new Map<string, StoryDTO>();
    for (const part of chunks(ids, 90)) {
      const rows = await this.db.selectFrom('stories').selectAll().where('team_id', '=', teamId).where('id', 'in', part).execute();
      for (const r of rows) byId.set(r.id, toStory(r));
    }
    return ids.map((id) => byId.get(id)).filter((s): s is StoryDTO => !!s);
  }

  async createStories(teamId: string, inputs: Omit<StoryDTO, 'id' | 'position' | 'createdAt' | 'updatedAt' | 'doneAt' | 'gitlabIid'>[]): Promise<StoryDTO[]> {
    await this.assertRoom('stories', teamId, inputs.length, LIMITS.storiesPerTeam, 'stories');
    await this.assertMembers(teamId, inputs.flatMap((s) => [s.ownerId, ...s.tasks.map((t) => t.ownerId)]));
    await this.assertReady(teamId, inputs.filter((s) => s.sprintId));
    const max = await this.db.selectFrom('stories').select((e) => e.fn.max<number>('position').as('p')).where('team_id', '=', teamId).executeTakeFirst();
    let position = Number(max?.p ?? -1) + 1;
    const ts = now();
    const rows = [];
    for (const s of inputs) {
      if (s.sprintId) await this.sprint(teamId, s.sprintId);
      rows.push({
        id: newId(),
        team_id: teamId,
        sprint_id: s.sprintId,
        kind: s.kind,
        title: s.title,
        as_a: s.asA,
        i_want: s.iWant,
        so_that: s.soThat,
        acceptance_criteria: JSON.stringify(s.acceptanceCriteria),
        notes: s.notes,
        estimate: s.estimate,
        status: s.status,
        invest: JSON.stringify(s.invest),
        dor: JSON.stringify(s.dor),
        external_url: s.externalUrl,
        tasks: JSON.stringify(s.tasks),
        owner_id: s.ownerId,
        position: position++,
        created_at: ts,
        updated_at: ts,
        done_at: s.status === 'done' ? ts : null,
        gitlab_iid: null,
        gitlab_estimate: null,
        gitlab_updated_at: null,
      });
    }
    await this.insertMany(this.db, 'stories', rows);
    return rows.map(toStory);
  }

  async updateStory(teamId: string, id: string, patch: Partial<Omit<StoryDTO, 'id' | 'createdAt' | 'updatedAt' | 'doneAt' | 'position'>>): Promise<StoryDTO> {
    const current = await this.story(teamId, id);
    if (patch.sprintId) await this.sprint(teamId, patch.sprintId);
    if (patch.sprintId && patch.sprintId !== current.sprintId) await this.assertReady(teamId, [{ ...current, ...patch }]);
    await this.assertMembers(teamId, [patch.ownerId, ...(patch.tasks ?? []).map((t) => t.ownerId)]);
    const status = patch.status ?? current.status;
    let doneAt = current.doneAt;
    if (status === 'done' && current.status !== 'done') doneAt = now();
    if (status !== 'done') doneAt = null;
    await this.db
      .updateTable('stories')
      .set({
        ...(patch.kind !== undefined && { kind: patch.kind }),
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.asA !== undefined && { as_a: patch.asA }),
        ...(patch.iWant !== undefined && { i_want: patch.iWant }),
        ...(patch.soThat !== undefined && { so_that: patch.soThat }),
        ...(patch.acceptanceCriteria !== undefined && { acceptance_criteria: JSON.stringify(patch.acceptanceCriteria) }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(patch.estimate !== undefined && { estimate: patch.estimate }),
        ...(patch.invest !== undefined && { invest: JSON.stringify(patch.invest) }),
        ...(patch.dor !== undefined && { dor: JSON.stringify(patch.dor) }),
        ...(patch.externalUrl !== undefined && { external_url: patch.externalUrl }),
        ...(patch.tasks !== undefined && { tasks: JSON.stringify(patch.tasks) }),
        ...(patch.ownerId !== undefined && { owner_id: patch.ownerId }),
        ...(patch.sprintId !== undefined && { sprint_id: patch.sprintId }),
        status,
        done_at: doneAt,
        updated_at: now(),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', id)
      .execute();
    return this.story(teamId, id);
  }

  async deleteStory(teamId: string, id: string): Promise<void> {
    await this.db.deleteFrom('stories').where('team_id', '=', teamId).where('id', '=', id).execute();
  }

  // ---------------------------------------------------------------- actions

  async createAction(teamId: string, input: { kind: ActionDTO['kind']; text: string; ownerId: string | null; dueDate: string | null; meetingId?: string | null }): Promise<ActionDTO> {
    await this.assertRoom('actions', teamId, 1, LIMITS.actionsPerTeam, 'actions');
    await this.assertMembers(teamId, [input.ownerId]);
    const row = {
      id: newId(),
      team_id: teamId,
      kind: input.kind,
      text: input.text,
      owner_id: input.ownerId,
      due_date: input.dueDate,
      status: 'open',
      meeting_id: input.meetingId ?? null,
      created_at: now(),
      completed_at: null,
    };
    await this.db.insertInto('actions').values(row).execute();
    return toAction(row);
  }

  async updateAction(teamId: string, id: string, patch: { text?: string; ownerId?: string | null; dueDate?: string | null; status?: ActionDTO['status'] }): Promise<void> {
    await this.assertMembers(teamId, [patch.ownerId]);
    const r = await this.db
      .updateTable('actions')
      .set({
        ...(patch.text !== undefined && { text: patch.text }),
        ...(patch.ownerId !== undefined && { owner_id: patch.ownerId }),
        ...(patch.dueDate !== undefined && { due_date: patch.dueDate }),
        ...(patch.status !== undefined && { status: patch.status, completed_at: patch.status === 'done' ? now() : null }),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound('Action not found');
  }

  async deleteAction(teamId: string, id: string): Promise<void> {
    await this.db.deleteFrom('actions').where('team_id', '=', teamId).where('id', '=', id).execute();
  }

  // ---------------------------------------------------------------- risks

  async createRisk(teamId: string, input: Omit<RiskDTO, 'id' | 'createdAt' | 'updatedAt'>): Promise<RiskDTO> {
    await this.assertRoom('risks', teamId, 1, LIMITS.risksPerTeam, 'risks');
    await this.assertMembers(teamId, [input.ownerId]);
    const ts = now();
    const row = {
      id: newId(),
      team_id: teamId,
      title: input.title,
      description: input.description,
      category: input.category,
      likelihood: input.likelihood,
      impact: input.impact,
      countermeasure: input.countermeasure,
      owner_id: input.ownerId,
      status: input.status,
      created_at: ts,
      updated_at: ts,
    };
    await this.db.insertInto('risks').values(row).execute();
    return toRisk(row);
  }

  async updateRisk(teamId: string, id: string, patch: Partial<Omit<RiskDTO, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void> {
    await this.assertMembers(teamId, [patch.ownerId]);
    const r = await this.db
      .updateTable('risks')
      .set({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.category !== undefined && { category: patch.category }),
        ...(patch.likelihood !== undefined && { likelihood: patch.likelihood }),
        ...(patch.impact !== undefined && { impact: patch.impact }),
        ...(patch.countermeasure !== undefined && { countermeasure: patch.countermeasure }),
        ...(patch.ownerId !== undefined && { owner_id: patch.ownerId }),
        ...(patch.status !== undefined && { status: patch.status }),
        updated_at: now(),
      })
      .where('team_id', '=', teamId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(r.numUpdatedRows) === 0) throw notFound('Risk not found');
  }

  async deleteRisk(teamId: string, id: string): Promise<void> {
    await this.db.deleteFrom('risks').where('team_id', '=', teamId).where('id', '=', id).execute();
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
