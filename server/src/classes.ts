import { DEFAULT_CLASS_SETTINGS, type ClassDTO, type ClassRole, type ClassSettings, type ClassSummaryDTO, type MemberDTO } from '@sprintwell/shared';
import { activityCounts } from './activity';
import { verifiedOf, type Repo } from './repo';
import { HttpError, badRequest, forbidden, newId, newInviteCode, notFound, now, parseJson } from './util';

const MAX_TEAMS_PER_CLASS = 60;
const MAX_CLASSES_PER_PERSON = 20;

/** Classes let teaching staff create teams for students and follow their activity. */
export class Classes {
  constructor(private readonly repo: Repo) {}

  private get db() {
    return this.repo.db;
  }

  async role(classId: string, userId: string): Promise<ClassRole | null> {
    const row = await this.db.selectFrom('class_staff').select('role').where('class_id', '=', classId).where('user_id', '=', userId).executeTakeFirst();
    return (row?.role as ClassRole) ?? null;
  }

  async requireStaff(classId: string, userId: string, owner = false): Promise<ClassRole> {
    const role = await this.role(classId, userId);
    if (!role) throw notFound('Class not found');
    if (owner && role !== 'owner') throw forbidden('Only the class owner can do that.');
    return role;
  }

  async create(userId: string, name: string): Promise<string> {
    const mine = await this.forUser(userId);
    if (mine.length >= MAX_CLASSES_PER_PERSON) throw badRequest(`You can run up to ${MAX_CLASSES_PER_PERSON} classes.`);
    const id = newId();
    const ts = now();
    await this.db.insertInto('classes').values({ id, name, staff_code: newInviteCode(), settings: JSON.stringify(DEFAULT_CLASS_SETTINGS), created_by: userId, created_at: ts }).execute();
    await this.db.insertInto('class_staff').values({ class_id: id, user_id: userId, role: 'owner', added_at: ts }).execute();
    return id;
  }

  async forUser(userId: string): Promise<ClassSummaryDTO[]> {
    const rows = await this.db
      .selectFrom('class_staff as cs')
      .innerJoin('classes as c', 'c.id', 'cs.class_id')
      .select(['c.id', 'c.name', 'cs.role'])
      .select((eb) => eb.selectFrom('teams as t').whereRef('t.class_id', '=', 'c.id').select((e) => e.fn.countAll<number>().as('n')).as('team_count'))
      .where('cs.user_id', '=', userId)
      .orderBy('c.created_at', 'desc')
      .execute();
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.role as ClassRole, teamCount: Number(r.team_count ?? 0) }));
  }

  async get(classId: string, viewerId: string): Promise<ClassDTO> {
    const myRole = await this.requireStaff(classId, viewerId);
    const c = await this.db.selectFrom('classes').selectAll().where('id', '=', classId).executeTakeFirstOrThrow();
    const staff = await this.db
      .selectFrom('class_staff as cs')
      .innerJoin('users as u', 'u.id', 'cs.user_id')
      .leftJoin('gitlab_accounts as g', 'g.user_id', 'u.id')
      .select(['u.id', 'u.display_name', 'g.username', 'cs.role'])
      .where('cs.class_id', '=', classId)
      .orderBy('cs.added_at')
      .execute();
    const teams = await this.db.selectFrom('teams').select(['id', 'name', 'invite_code']).where('class_id', '=', classId).orderBy('name').execute();
    const ids = teams.map((t) => t.id);
    const members = new Map<string, MemberDTO[]>();
    for (let i = 0; i < ids.length; i += 50) {
      const rows = await this.db
        .selectFrom('memberships as m')
        .innerJoin('users as u', 'u.id', 'm.user_id')
        .leftJoin('gitlab_accounts as g', 'g.user_id', 'u.id')
        .select(['m.team_id', 'u.id', 'u.display_name', 'm.role', 'm.joined_at', 'g.username', 'g.source'])
        .where('m.team_id', 'in', ids.slice(i, i + 50))
        .orderBy('m.joined_at')
        .execute();
      for (const r of rows) {
        const list = members.get(r.team_id) ?? [];
        list.push({ userId: r.id, displayName: r.display_name, role: r.role as MemberDTO['role'], joinedAt: r.joined_at, gitlabUsername: r.username ?? null, gitlabVerified: verifiedOf(r.source) });
        members.set(r.team_id, list);
      }
    }
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const counts = ids.length ? await activityCounts(this.db, ids) : [];
    const recent = ids.length ? await activityCounts(this.db, ids, weekAgo) : [];
    return {
      id: c.id,
      name: c.name,
      staffCode: c.staff_code,
      settings: { ...DEFAULT_CLASS_SETTINGS, ...parseJson<Partial<ClassSettings>>(c.settings, {}) },
      myRole,
      staff: staff.map((s) => ({ userId: s.id, displayName: s.display_name, gitlabUsername: s.username ?? null, role: s.role as ClassRole })),
      teams: teams.map((t) => {
        const mine = counts.filter((x) => x.teamId === t.id);
        return {
          id: t.id,
          name: t.name,
          inviteCode: t.invite_code,
          members: members.get(t.id) ?? [],
          lastActivityAt: mine.reduce<string | null>((a, x) => (!a || x.last > a ? x.last : a), null),
          recentActivity: recent.filter((x) => x.teamId === t.id).reduce((a, x) => a + x.n, 0),
        };
      }),
    };
  }

  async update(classId: string, userId: string, patch: { name?: string; settings?: Partial<ClassSettings> }): Promise<void> {
    await this.requireStaff(classId, userId);
    const c = await this.db.selectFrom('classes').select('settings').where('id', '=', classId).executeTakeFirstOrThrow();
    const settings = { ...DEFAULT_CLASS_SETTINGS, ...parseJson<Partial<ClassSettings>>(c.settings, {}), ...(patch.settings ?? {}) };
    await this.db
      .updateTable('classes')
      .set({ ...(patch.name ? { name: patch.name } : {}), settings: JSON.stringify(settings) })
      .where('id', '=', classId)
      .execute();
  }

  async addTeams(classId: string, userId: string, names: string[]): Promise<string[]> {
    await this.requireStaff(classId, userId);
    const n = await this.db.selectFrom('teams').select((e) => e.fn.countAll<number>().as('n')).where('class_id', '=', classId).executeTakeFirstOrThrow();
    if (Number(n.n) + names.length > MAX_TEAMS_PER_CLASS) throw badRequest(`A class can have up to ${MAX_TEAMS_PER_CLASS} teams.`);
    const ids: string[] = [];
    for (const name of names) ids.push(await this.repo.createTeam(userId, name, true, classId));
    return ids;
  }

  async joinAsStaff(code: string, userId: string): Promise<string> {
    const c = await this.db.selectFrom('classes').select('id').where('staff_code', '=', code.trim().toLowerCase()).executeTakeFirst();
    if (!c) throw notFound('That teaching-staff link is not valid any more.');
    if (!(await this.role(c.id, userId))) await this.db.insertInto('class_staff').values({ class_id: c.id, user_id: userId, role: 'staff', added_at: now() }).execute();
    return c.id;
  }

  async regenerateStaffCode(classId: string, userId: string): Promise<string> {
    await this.requireStaff(classId, userId, true);
    const code = newInviteCode();
    await this.db.updateTable('classes').set({ staff_code: code }).where('id', '=', classId).execute();
    return code;
  }

  async removeStaff(classId: string, actorId: string, userId: string): Promise<void> {
    const role = await this.requireStaff(classId, actorId);
    if (actorId !== userId && role !== 'owner') throw forbidden('Only the class owner can remove other staff.');
    const target = await this.role(classId, userId);
    if (target === 'owner') throw forbidden('The class owner cannot be removed. Delete the class instead.');
    await this.db.deleteFrom('class_staff').where('class_id', '=', classId).where('user_id', '=', userId).execute();
  }

  /**
   * Deletes a class. Teams nobody joined are deleted; teams with members stay
   * with their members (they simply stop belonging to the class).
   */
  async remove(classId: string, userId: string): Promise<string[]> {
    await this.requireStaff(classId, userId, true);
    const teams = await this.db.selectFrom('teams').select('id').where('class_id', '=', classId).execute();
    const deleted: string[] = [];
    for (const t of teams) {
      const m = await this.db.selectFrom('memberships').select('user_id').where('team_id', '=', t.id).executeTakeFirst();
      if (!m) {
        await this.repo.deleteTeam(t.id);
        deleted.push(t.id);
      }
    }
    await this.db.updateTable('teams').set({ class_id: null }).where('class_id', '=', classId).execute();
    await this.db.deleteFrom('classes').where('id', '=', classId).execute();
    return deleted;
  }

  /** Throws unless the person is a member of one of the class's teams. */
  async requireStudent(classId: string, userId: string): Promise<string> {
    const row = await this.db
      .selectFrom('memberships as m')
      .innerJoin('teams as t', 't.id', 'm.team_id')
      .select('t.id')
      .where('t.class_id', '=', classId)
      .where('m.user_id', '=', userId)
      .executeTakeFirst();
    if (!row) throw notFound('That person is not in a team in this class.');
    return row.id;
  }

  /** A project access token that can look up GitLab users: the student's team's, or any team's in the class. */
  async lookupToken(classId: string, userId: string, open: (sealed: string | null) => string | null): Promise<string> {
    const teamId = await this.requireStudent(classId, userId);
    const rows = await this.db
      .selectFrom('team_gitlab as g')
      .innerJoin('teams as t', 't.id', 'g.team_id')
      .select(['g.team_id', 'g.token'])
      .where('t.class_id', '=', classId)
      .where('g.token', 'is not', null)
      .execute();
    rows.sort((a, b) => (a.team_id === teamId ? -1 : b.team_id === teamId ? 1 : 0));
    for (const r of rows) {
      const t = open(r.token);
      if (t) return t;
    }
    throw new HttpError(409, 'Sprintwell needs a GitLab project linked to a team in this class (with its access token) to look up usernames.');
  }

  /** Staff of the class a team belongs to (for notifications and checks). */
  async teamClassId(teamId: string): Promise<string | null> {
    const t = await this.db.selectFrom('teams').select('class_id').where('id', '=', teamId).executeTakeFirst();
    if (!t) throw new HttpError(404, 'Team not found');
    return t.class_id;
  }
}
