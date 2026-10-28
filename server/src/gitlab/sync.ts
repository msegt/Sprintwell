import { ESTIMATE_LABEL_PREFIX, LIMITS, cardToNumber, estimateFromIssue, estimateLabels, parseIssueDescription, type TeamGitlabDTO } from '@sprintwell/shared';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { logActivity, type ActivityEntry } from '../activity';
import type { Config } from '../config';
import type { Repo } from '../repo';
import { HttpError, badRequest, now } from '../util';
import type { GitlabAuth } from './auth';
import { GitlabError, gitlabApi } from './client';
import { canWrite, toStatus, type Link } from './status';

interface GlProject {
  id: number;
  path_with_namespace: string;
  web_url: string;
}

interface GlIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: 'opened' | 'closed';
  labels: string[];
  weight?: number | null;
  milestone: { id: number } | null;
  web_url: string;
  updated_at: string;
}

interface GlMilestone {
  id: number;
  title: string;
  description: string | null;
  state: 'active' | 'closed';
  start_date: string | null;
  due_date: string | null;
}

interface GlEvent {
  id: number;
  action_name: string;
  target_type: string | null;
  target_iid: number | null;
  target_title: string | null;
  author_id: number;
  author: { id: number; username: string; name: string } | null;
  author_username?: string;
  created_at: string;
  push_data?: { commit_count: number; ref: string | null; ref_type: string; commit_title: string | null } | null;
  note?: { noteable_type: string; noteable_iid: number | null; body: string; system?: boolean } | null;
}

/** Limits that keep one sync inside the Cloudflare free plan (50 external requests, 10 ms CPU). */
const MAX_ISSUE_PAGES = 2;
const MAX_EVENT_PAGES = 3;
const PER_PAGE = 100;

export interface SyncResult {
  issuesCreated: number;
  issuesUpdated: number;
  sprintsCreated: number;
  sprintsUpdated: number;
  estimatesPushed: number;
  events: number;
  /** True when there was more to read than one sync handles; syncing again continues. */
  partial: boolean;
}

const enc = encodeURIComponent;

export class GitlabSync {
  constructor(
    private readonly repo: Repo,
    private readonly auth: GitlabAuth,
    private readonly config: Config,
  ) {}

  private get gl() {
    return this.config.gitlab;
  }

  private async linkOf(teamId: string): Promise<Link | undefined> {
    return this.repo.db.selectFrom('team_gitlab').selectAll().where('team_id', '=', teamId).executeTakeFirst();
  }

  async status(teamId: string): Promise<TeamGitlabDTO | null> {
    const row = await this.linkOf(teamId);
    return row ? toStatus(row) : null;
  }

  /**
   * The token Sprintwell uses for a team: its project access token if it has
   * one, otherwise the GitLab access the person allowed through OAuth.
   */
  private async tokenFor(link: Link, actorId: string | null): Promise<string> {
    if (link.token) {
      const t = this.auth.open(link.token);
      if (!t) throw new HttpError(409, 'The team’s GitLab access token can no longer be read. Add a new one on the Team page.');
      if (link.token_expires_at && link.token_expires_at.slice(0, 10) < now().slice(0, 10)) throw new HttpError(409, 'The team’s GitLab access token has expired. Add a new one on the Team page.');
      return t;
    }
    if (!actorId) throw new HttpError(409, 'Add a project access token on the Team page so Sprintwell can reach GitLab.');
    return this.auth.accessToken(actorId, link.origin, true);
  }

  /** Accepts a project URL (https://git.example.ac.uk/group/project) or a path (group/project). */
  projectPath(input: string): string {
    let path = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      const base = new URL(this.gl.url);
      if (u.host !== base.host) throw badRequest(`That project is not on ${base.host}, the GitLab this Sprintwell uses.`);
      path = u.pathname.replace(/^\/+/, '').split('/-/')[0]!;
    }
    if (!/^[\w.-]+(\/[\w.-]+)+$/.test(path)) throw badRequest('Paste the project address, for example https://git.example.ac.uk/group/project');
    return path;
  }

  /**
   * Links a team to its GitLab project, either with a project access token
   * (created in GitLab under Settings > Access tokens) or, where Sign in with
   * GitLab is set up, with the person's own GitLab access.
   */
  async link(teamId: string, actorId: string, project: string, origin: string, projectToken?: string): Promise<TeamGitlabDTO> {
    const path = this.projectPath(project);
    const db = this.repo.db;
    let token: string;
    let scopes: string | null = null;
    let expires: string | null = null;
    if (projectToken) {
      token = projectToken.trim();
      const { data: p } = await gitlabApi<GlProject>(this.gl, token, `/projects/${enc(path)}`, { what: 'open that project with this token' }).catch((e) => {
        if (e instanceof GitlabError && e.upstreamStatus === 401) throw badRequest('GitLab did not accept that token. Check you copied all of it and that it has not expired.');
        if (e instanceof GitlabError && e.upstreamStatus === 404) throw badRequest('That token cannot see this project. Create the token in the project itself (Settings → Access tokens).');
        throw e;
      });
      const self = await gitlabApi<{ scopes?: string[]; expires_at?: string | null }>(this.gl, token, '/personal_access_tokens/self', { what: 'read the token details' }).catch(() => null);
      scopes = self?.data.scopes?.join(' ') ?? null;
      expires = self?.data.expires_at ?? null;
      if (scopes && !/\b(api|read_api)\b/.test(scopes)) throw badRequest('The token needs the “api” scope (or “read_api” to import without writing estimates back).');
      return this.saveLink(teamId, actorId, p, origin, { token: this.auth.seal(token), token_scopes: scopes, token_expires_at: expires });
    }
    if (!this.auth.oauth) throw badRequest('Add a project access token: create one in the GitLab project under Settings → Access tokens.');
    token = await this.auth.accessToken(actorId, origin, true);
    const { data: p } = await gitlabApi<GlProject>(this.gl, token, `/projects/${enc(path)}`, { what: 'find that project' });
    const me = await db.selectFrom('gitlab_accounts').select('gitlab_id').where('user_id', '=', actorId).executeTakeFirstOrThrow();
    await gitlabApi(this.gl, token, `/projects/${p.id}/members/all/${me.gitlab_id}`, { what: 'confirm that you are a member of the project' }).catch((e) => {
      if (e instanceof GitlabError && e.upstreamStatus === 404) throw badRequest('You need to be a member of that GitLab project to link it.');
      throw e;
    });
    return this.saveLink(teamId, actorId, p, origin, { token: null, token_scopes: null, token_expires_at: null });
  }

  private async saveLink(teamId: string, actorId: string, p: GlProject, origin: string, access: { token: string | null; token_scopes: string | null; token_expires_at: string | null }): Promise<TeamGitlabDTO> {
    const db = this.repo.db;
    const existing = await this.linkOf(teamId);
    const sameProject = existing?.project_id === String(p.id);
    const values = {
      project_id: String(p.id),
      path: p.path_with_namespace,
      web_url: p.web_url,
      origin,
      linked_by: actorId,
      linked_at: sameProject ? existing!.linked_at : now(),
      ...access,
      // Replacing the token for the same project keeps sync progress and the webhook.
      ...(!sameProject && { last_sync_at: null, events_after: null, issues_after: null, estimate_field: 'unknown', webhook_secret: null, webhook_at: null }),
    };
    if (existing) await db.updateTable('team_gitlab').set(values).where('team_id', '=', teamId).execute();
    else await db.insertInto('team_gitlab').values({ last_sync_at: null, events_after: null, issues_after: null, estimate_field: 'unknown', webhook_secret: null, webhook_at: null, ...values, team_id: teamId }).execute();
    // Also show it as the team's tracker link.
    await this.repo.updateTeam(teamId, { settings: { trackerUrl: p.web_url } });
    return (await this.status(teamId))!;
  }

  async unlink(teamId: string): Promise<void> {
    await this.repo.db.deleteFrom('team_gitlab').where('team_id', '=', teamId).execute();
  }

  /** The webhook address and secret for a team, creating the secret on first use. */
  async webhook(teamId: string, origin: string): Promise<{ url: string; secret: string; lastReceivedAt: string | null }> {
    const link = await this.linkOf(teamId);
    if (!link) throw new HttpError(409, 'Link a GitLab project first.');
    let secret = this.auth.open(link.webhook_secret);
    if (!secret) {
      secret = randomBytes(24).toString('base64url');
      await this.repo.db.updateTable('team_gitlab').set({ webhook_secret: this.auth.seal(secret) }).where('team_id', '=', teamId).execute();
    }
    return { url: `${this.config.publicUrl || origin}/api/gitlab/hooks/${teamId}`, secret, lastReceivedAt: link.webhook_at };
  }

  /**
   * Handles a GitLab webhook. The payload is treated only as a signal that
   * something changed: Sprintwell then reads the changes from GitLab's API with
   * the team's own token, so a forged payload cannot add made-up activity.
   */
  async onWebhook(teamId: string, presentedSecret: string | undefined, payload: unknown): Promise<{ events: number; issues: number }> {
    const link = await this.linkOf(teamId);
    const secret = link ? this.auth.open(link.webhook_secret) : null;
    if (!link || !secret || !presentedSecret || !sameSecret(secret, presentedSecret)) throw new HttpError(401, 'Unknown webhook.');
    const db = this.repo.db;
    await db.updateTable('team_gitlab').set({ webhook_at: now() }).where('team_id', '=', teamId).execute();
    if (!link.token) return { events: 0, issues: 0 };
    const token = await this.tokenFor(link, null);
    let issues = 0;
    const body = (payload ?? {}) as { object_kind?: string; object_attributes?: { iid?: number } };
    if (body.object_kind === 'issue' && typeof body.object_attributes?.iid === 'number') {
      const { data } = await gitlabApi<GlIssue>(this.gl, token, `/projects/${link.project_id}/issues/${body.object_attributes.iid}`, { what: 'read the issue' });
      const r = await this.applyIssues(teamId, [data]);
      issues = r.created + r.updated;
    }
    const ev = await this.importEvents(teamId, link, token, 1);
    await db.updateTable('team_gitlab').set({ events_after: ev.partial ? (ev.lastAt ?? link.events_after) : now() }).where('team_id', '=', teamId).execute();
    return { events: ev.logged, issues };
  }

  /**
   * Imports milestones (as sprints), issues (as backlog items) and recent
   * project events (into the activity log), then pushes estimates that changed
   * in Sprintwell back to GitLab.
   */
  async sync(teamId: string, actorId: string): Promise<SyncResult> {
    const db = this.repo.db;
    const link = await this.linkOf(teamId);
    if (!link) throw new HttpError(409, 'Link a GitLab project on the Team page first.');
    const token = await this.tokenFor(link, actorId);
    const result: SyncResult = { issuesCreated: 0, issuesUpdated: 0, sprintsCreated: 0, sprintsUpdated: 0, estimatesPushed: 0, events: 0, partial: false };
    const startedAt = now();

    // ---- milestones → sprints
    const { data: milestones } = await gitlabApi<GlMilestone[]>(this.gl, token, `/projects/${link.project_id}/milestones?per_page=${PER_PAGE}`, { what: 'read milestones' });
    const sprints = await db.selectFrom('sprints').selectAll().where('team_id', '=', teamId).execute();
    const sprintByMilestone = new Map(sprints.filter((s) => s.gitlab_milestone_id).map((s) => [s.gitlab_milestone_id!, s]));
    for (const m of milestones.slice(0, LIMITS.sprintsPerTeam)) {
      const existing = sprintByMilestone.get(String(m.id)) ?? sprints.find((s) => !s.gitlab_milestone_id && s.name.trim().toLowerCase() === m.title.trim().toLowerCase());
      const fields = { name: m.title.slice(0, LIMITS.title), start_date: m.start_date, end_date: m.due_date, gitlab_milestone_id: String(m.id) };
      if (existing) {
        if (existing.name !== fields.name || existing.start_date !== fields.start_date || existing.end_date !== fields.end_date || existing.gitlab_milestone_id !== fields.gitlab_milestone_id) {
          await db.updateTable('sprints').set(fields).where('id', '=', existing.id).execute();
          result.sprintsUpdated++;
        }
        sprintByMilestone.set(String(m.id), { ...existing, ...fields });
      } else if (m.state === 'active') {
        const created = await this.repo.createSprint(teamId, { name: fields.name, goal: (m.description ?? '').split('\n')[0]!.slice(0, LIMITS.shortText), startDate: m.start_date, endDate: m.due_date });
        await db.updateTable('sprints').set({ gitlab_milestone_id: String(m.id) }).where('id', '=', created.id).execute();
        result.sprintsCreated++;
      }
    }

    // ---- issues → backlog items (only those changed since the last sync)
    // Cursor "<updated_after>|<page>": continue by time, or by page when many issues share a time.
    const [cursorFrom, cursorPage] = (link.issues_after ?? '').split('|');
    const issuesFrom = cursorFrom || link.last_sync_at;
    const firstPage = Number(cursorPage) > 1 ? Number(cursorPage) : 1;
    const since = issuesFrom ? `&updated_after=${enc(new Date(Date.parse(issuesFrom) - 60_000).toISOString())}` : '';
    let issuesPartial = false;
    let lastPage = firstPage;
    const issues: GlIssue[] = [];
    for (let page = firstPage; page < firstPage + MAX_ISSUE_PAGES; page++) {
      lastPage = page;
      const { data, headers } = await gitlabApi<GlIssue[]>(this.gl, token, `/projects/${link.project_id}/issues?per_page=${PER_PAGE}&page=${page}&order_by=updated_at&sort=asc&scope=all${since}`, { what: 'read issues' });
      issues.push(...data);
      if (!headers.get('x-next-page')) break;
      if (page === firstPage + MAX_ISSUE_PAGES - 1) issuesPartial = result.partial = true;
    }
    const applied = await this.applyIssues(teamId, issues);
    result.issuesCreated = applied.created;
    result.issuesUpdated = applied.updated;
    if (applied.full) result.partial = true;

    // ---- Sprintwell estimates → GitLab
    if (canWrite(link)) {
      const changed = await db
        .selectFrom('stories')
        .select(['id'])
        .where('team_id', '=', teamId)
        .where('gitlab_iid', 'is not', null)
        .where((eb) => eb.or([eb('estimate', '!=', eb.ref('gitlab_estimate')), eb.and([eb('estimate', 'is not', null), eb('gitlab_estimate', 'is', null)])]))
        .limit(20)
        .execute();
      for (const { id } of changed) {
        if (await this.pushEstimate(teamId, id, actorId).catch(() => false)) result.estimatesPushed++;
      }
    }

    // ---- project events → activity log
    const ev = await this.importEvents(teamId, link, token, MAX_EVENT_PAGES);
    result.events = ev.logged;
    if (ev.partial) result.partial = true;

    // Cursors: continue where this sync stopped if it could not read everything.
    const lastIssue = issues[issues.length - 1];
    let issuesAfter = `${startedAt}|1`;
    if (issuesPartial && lastIssue) {
      const progressed = !issuesFrom || Date.parse(lastIssue.updated_at) - 60_000 > Date.parse(issuesFrom);
      issuesAfter = progressed ? `${lastIssue.updated_at}|1` : `${issuesFrom}|${lastPage + 1}`;
    }
    await db
      .updateTable('team_gitlab')
      .set({ last_sync_at: startedAt, issues_after: issuesAfter, events_after: ev.partial ? (ev.lastAt ?? link.events_after) : startedAt })
      .where('team_id', '=', teamId)
      .execute();
    return result;
  }

  /** Creates or updates backlog items from GitLab issues. */
  private async applyIssues(teamId: string, issues: GlIssue[]): Promise<{ created: number; updated: number; full: boolean }> {
    const db = this.repo.db;
    const out = { created: 0, updated: 0, full: false };
    if (!issues.length) return out;
    const iids = issues.map((i) => i.iid);
    const stories = [];
    for (let i = 0; i < iids.length; i += 90) {
      stories.push(...(await db.selectFrom('stories').selectAll().where('team_id', '=', teamId).where('gitlab_iid', 'in', iids.slice(i, i + 90)).execute()));
    }
    const byIid = new Map(stories.map((s) => [Number(s.gitlab_iid), s]));
    const fresh: GlIssue[] = [];
    for (const issue of issues) {
      const story = byIid.get(issue.iid);
      const glEstimate = estimateFromIssue(issue.weight, issue.labels);
      if (!story) {
        if (issue.state === 'closed') continue; // old, finished work stays in GitLab
        fresh.push(issue);
        continue;
      }
      if (story.gitlab_updated_at && story.gitlab_updated_at >= issue.updated_at) continue;
      const parsed = parseIssueDescription(issue.description);
      // Text changes come from GitLab only when GitLab changed after Sprintwell did.
      const gitlabNewer = Date.parse(issue.updated_at) > Date.parse(story.updated_at);
      const set: Record<string, unknown> = { gitlab_updated_at: issue.updated_at, external_url: issue.web_url };
      if (gitlabNewer) {
        Object.assign(set, {
          title: issue.title.slice(0, LIMITS.title),
          ...(parsed.asA && { as_a: parsed.asA.slice(0, LIMITS.shortText), i_want: parsed.iWant.slice(0, LIMITS.shortText), so_that: parsed.soThat.slice(0, LIMITS.shortText) }),
          ...(parsed.acceptanceCriteria.length && { acceptance_criteria: JSON.stringify(parsed.acceptanceCriteria.map((c) => c.slice(0, LIMITS.shortText))) }),
        });
      }
      if (glEstimate !== story.gitlab_estimate) {
        // Someone changed the estimate in GitLab: take it.
        set.estimate = glEstimate;
        set.gitlab_estimate = glEstimate;
      }
      if (issue.state === 'closed' && story.status !== 'done') Object.assign(set, { status: 'done', done_at: issue.updated_at });
      await db.updateTable('stories').set(set).where('id', '=', story.id).execute();
      out.updated++;
    }
    if (fresh.length) {
      const room = LIMITS.storiesPerTeam - Number((await db.selectFrom('stories').select((e) => e.fn.countAll<number>().as('n')).where('team_id', '=', teamId).executeTakeFirstOrThrow()).n);
      const take = fresh.slice(0, Math.max(0, room));
      if (take.length < fresh.length) out.full = true;
      const created = await this.repo.createStories(
        teamId,
        take.map((issue) => {
          const parsed = parseIssueDescription(issue.description);
          return {
            sprintId: null,
            kind: issue.labels.some((l) => /^(bug|defect)$/i.test(l)) ? 'bug' : issue.labels.some((l) => /^spike$/i.test(l)) ? 'spike' : 'story',
            title: issue.title.slice(0, LIMITS.title),
            asA: parsed.asA.slice(0, LIMITS.shortText),
            iWant: parsed.iWant.slice(0, LIMITS.shortText),
            soThat: parsed.soThat.slice(0, LIMITS.shortText),
            acceptanceCriteria: parsed.acceptanceCriteria.map((c) => c.slice(0, LIMITS.shortText)),
            notes: parsed.notes.slice(0, LIMITS.longText),
            estimate: estimateFromIssue(issue.weight, issue.labels),
            status: 'backlog',
            invest: {},
            dor: {},
            externalUrl: issue.web_url,
            tasks: [],
            ownerId: null,
          };
        }),
      );
      // Imported items start in the Product Backlog, even if the issue is in a GitLab
      // milestone: they enter a sprint only once they meet the Definition of Ready.
      for (const [i, story] of created.entries()) {
        const issue = take[i]!;
        try {
          await db
            .updateTable('stories')
            .set({ gitlab_iid: issue.iid, gitlab_estimate: estimateFromIssue(issue.weight, issue.labels), gitlab_updated_at: issue.updated_at })
            .where('id', '=', story.id)
            .execute();
          out.created++;
        } catch {
          // Another sync (e.g. a webhook) imported this issue at the same moment.
          await db.deleteFrom('stories').where('id', '=', story.id).execute();
        }
      }
    }
    return out;
  }

  /** Reads project events since the team's cursor and records them as activity. */
  private async importEvents(teamId: string, link: Link, token: string, maxPages: number): Promise<{ logged: number; partial: boolean; lastAt: string | null }> {
    const db = this.repo.db;
    const after = (link.events_after ?? new Date(Date.parse(link.linked_at) - 14 * 86_400_000).toISOString()).slice(0, 10);
    const members = await db
      .selectFrom('memberships as m')
      .innerJoin('gitlab_accounts as g', 'g.user_id', 'm.user_id')
      .select(['m.user_id', 'g.gitlab_id', 'g.username'])
      .where('m.team_id', '=', teamId)
      .execute();
    const people: People = { byId: new Map(members.map((m) => [m.gitlab_id, m.user_id])), byUsername: new Map(members.map((m) => [m.username.toLowerCase(), m.user_id])) };
    const entries: ActivityEntry[] = [];
    let partial = false;
    let lastAt: string | null = null;
    for (let page = 1; page <= maxPages; page++) {
      // GitLab's "after" is a date and exclusive, so ask from the day before; duplicates are ignored.
      // (A single day with more events than one sync reads cannot be read in full.)
      const day = new Date(Date.parse(`${after}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const { data, headers } = await gitlabApi<GlEvent[]>(this.gl, token, `/projects/${link.project_id}/events?after=${day}&per_page=${PER_PAGE}&page=${page}&sort=asc`, { what: 'read project activity' });
      for (const ev of data) {
        const entry = this.describeEvent(teamId, link.web_url, ev, people);
        if (entry) entries.push(entry);
        if (!lastAt || ev.created_at > lastAt) lastAt = ev.created_at;
      }
      if (!headers.get('x-next-page')) break;
      if (page === maxPages) partial = true;
    }
    return { logged: await logActivity(db, entries), partial, lastAt };
  }

  private describeEvent(teamId: string, web: string, ev: GlEvent, people: People): ActivityEntry | null {
    const username = ev.author?.username ?? ev.author_username ?? 'someone';
    const userId = people.byId.get(String(ev.author_id)) ?? people.byUsername.get(username.toLowerCase()) ?? null;
    const who = userId ? '' : `@${username} `;
    const base = { teamId, userId, source: 'gitlab' as const, dedupe: `gitlab:${teamId}:${web}:${ev.id}`, at: ev.created_at };
    const title = ev.target_title ? `“${ev.target_title}”` : '';
    const action = ev.action_name;
    if (ev.push_data) {
      const n = ev.push_data.commit_count;
      if (n === 0) return null;
      const ref = ev.push_data.ref ?? '';
      return { ...base, kind: 'gitlab-commit', summary: `${who}pushed ${n} commit${n === 1 ? '' : 's'} to ${ref}${ev.push_data.commit_title ? `: “${ev.push_data.commit_title}”` : ''}`, url: ref ? `${web}/-/commits/${enc(ref)}` : web };
    }
    if (ev.note) {
      if (ev.note.system) return null;
      const onMr = ev.note.noteable_type === 'MergeRequest';
      const iid = ev.note.noteable_iid;
      const where = onMr ? `merge request !${iid}` : ev.note.noteable_type === 'Issue' ? `issue #${iid}` : 'GitLab';
      const url = onMr ? `${web}/-/merge_requests/${iid}` : ev.note.noteable_type === 'Issue' ? `${web}/-/issues/${iid}` : web;
      return { ...base, kind: onMr ? 'gitlab-review' : 'gitlab-other', summary: `${who}commented on ${where}${title ? ` ${title}` : ''}`, url };
    }
    if (ev.target_type === 'MergeRequest') {
      const url = `${web}/-/merge_requests/${ev.target_iid}`;
      if (action === 'approved') return { ...base, kind: 'gitlab-review', summary: `${who}approved merge request !${ev.target_iid} ${title}`, url };
      const verb = action === 'accepted' ? 'merged' : action;
      return { ...base, kind: 'gitlab-mr', summary: `${who}${verb} merge request !${ev.target_iid} ${title}`, url };
    }
    if (ev.target_type === 'Issue') {
      return { ...base, kind: 'gitlab-issue', summary: `${who}${action} issue #${ev.target_iid} ${title}`, url: `${web}/-/issues/${ev.target_iid}` };
    }
    if (ev.target_type === 'Milestone') return { ...base, kind: 'gitlab-other', summary: `${who}${action} milestone ${title}`, url: `${web}/-/milestones` };
    return null;
  }

  /**
   * Writes a story's estimate to its GitLab issue: as the issue weight when this
   * GitLab supports weights (and the estimate is a number), otherwise as a
   * "points::N" label. Returns false if there was nothing to do.
   */
  async pushEstimate(teamId: string, storyId: string, actorId: string | null): Promise<boolean> {
    const db = this.repo.db;
    const link = await this.linkOf(teamId);
    const story = await db.selectFrom('stories').selectAll().where('team_id', '=', teamId).where('id', '=', storyId).executeTakeFirst();
    if (!link || !story || story.gitlab_iid === null) return false;
    if ((story.estimate ?? null) === (story.gitlab_estimate ?? null)) return false;
    if (!canWrite(link)) throw new HttpError(409, 'The team’s GitLab token can only read. Give it the “api” scope to send estimates to GitLab.');
    const token = await this.tokenFor(link, actorId);
    const path = `/projects/${link.project_id}/issues/${story.gitlab_iid}`;
    const numeric = story.estimate !== null ? cardToNumber(story.estimate) : null;
    const wholeNumber = numeric !== null && Number.isInteger(numeric) && numeric >= 0;
    let field = link.estimate_field;

    if (field !== 'label' && (wholeNumber || story.estimate === null)) {
      const { data } = await gitlabApi<GlIssue>(this.gl, token, path, { method: 'PUT', body: { weight: story.estimate === null ? null : numeric }, what: 'update the issue weight' });
      const supported = 'weight' in data && (data.weight === (story.estimate === null ? null : numeric));
      if (supported) {
        if (field !== 'weight') await db.updateTable('team_gitlab').set({ estimate_field: 'weight' }).where('team_id', '=', teamId).execute();
        await this.removeEstimateLabels(token, path, data.labels);
        await db.updateTable('stories').set({ gitlab_estimate: story.estimate, gitlab_updated_at: data.updated_at }).where('id', '=', story.id).execute();
        return true;
      }
      // This GitLab has no weights (e.g. the free edition): use labels from now on.
      field = 'label';
      await db.updateTable('team_gitlab').set({ estimate_field: 'label' }).where('team_id', '=', teamId).execute();
    }

    const { data: issue } = await gitlabApi<GlIssue>(this.gl, token, path, { what: 'read the issue' });
    const remove = estimateLabels(issue.labels);
    const add = story.estimate !== null ? `${ESTIMATE_LABEL_PREFIX}${story.estimate}` : null;
    const { data } = await gitlabApi<GlIssue>(this.gl, token, path, {
      method: 'PUT',
      body: { ...(remove.length && { remove_labels: remove.filter((l) => l !== add).join(',') }), ...(add && { add_labels: add }) },
      what: 'update the issue labels',
    });
    await db.updateTable('stories').set({ gitlab_estimate: story.estimate, gitlab_updated_at: data.updated_at }).where('id', '=', story.id).execute();
    return true;
  }

  private async removeEstimateLabels(token: string, path: string, labels: string[]): Promise<void> {
    const remove = estimateLabels(labels);
    if (remove.length) await gitlabApi(this.gl, token, path, { method: 'PUT', body: { remove_labels: remove.join(',') }, what: 'update the issue labels' });
  }
}

interface People {
  byId: Map<string, string>;
  byUsername: Map<string, string>;
}

function sameSecret(a: string, b: string): boolean {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
}
