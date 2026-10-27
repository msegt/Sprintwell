import { ESTIMATE_LABEL_PREFIX, LIMITS, cardToNumber, estimateFromIssue, estimateLabels, parseIssueDescription, type TeamGitlabDTO } from '@sprintwell/shared';
import { logActivity, type ActivityEntry } from '../activity';
import type { Config } from '../config';
import type { Repo } from '../repo';
import { HttpError, badRequest, now } from '../util';
import type { GitlabAuth } from './auth';
import { GitlabError, gitlabApi } from './client';

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

  async status(teamId: string): Promise<TeamGitlabDTO | null> {
    const row = await this.repo.db.selectFrom('team_gitlab').selectAll().where('team_id', '=', teamId).executeTakeFirst();
    if (!row) return null;
    return { path: row.path, webUrl: row.web_url, lastSyncAt: row.last_sync_at, estimateField: row.estimate_field as TeamGitlabDTO['estimateField'] };
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

  async link(teamId: string, actorId: string, project: string, origin: string): Promise<TeamGitlabDTO> {
    const token = await this.auth.accessToken(actorId, origin, true);
    const path = this.projectPath(project);
    const { data: p } = await gitlabApi<GlProject>(this.gl, token, `/projects/${enc(path)}`, { what: 'find that project' });
    const me = await this.repo.db.selectFrom('gitlab_accounts').select('gitlab_id').where('user_id', '=', actorId).executeTakeFirstOrThrow();
    await gitlabApi(this.gl, token, `/projects/${p.id}/members/all/${me.gitlab_id}`, { what: 'confirm that you are a member of the project' }).catch((e) => {
      if (e instanceof GitlabError && e.upstreamStatus === 404) throw badRequest('You need to be a member of that GitLab project to link it.');
      throw e;
    });
    const values = { project_id: String(p.id), path: p.path_with_namespace, web_url: p.web_url, origin, linked_by: actorId, linked_at: now(), last_sync_at: null, events_after: null, issues_after: null, estimate_field: 'unknown' };
    const db = this.repo.db;
    if (await db.selectFrom('team_gitlab').select('team_id').where('team_id', '=', teamId).executeTakeFirst()) {
      await db.updateTable('team_gitlab').set(values).where('team_id', '=', teamId).execute();
    } else {
      await db.insertInto('team_gitlab').values({ ...values, team_id: teamId }).execute();
    }
    // Also show it as the team's tracker link.
    await this.repo.updateTeam(teamId, { settings: { trackerUrl: p.web_url } });
    return (await this.status(teamId))!;
  }

  async unlink(teamId: string): Promise<void> {
    await this.repo.db.deleteFrom('team_gitlab').where('team_id', '=', teamId).execute();
  }

  /**
   * Imports milestones (as sprints), issues (as backlog items) and recent
   * project events (into the activity log), then pushes estimates that changed
   * in Sprintwell back to GitLab. Runs as the person who asked for it.
   */
  async sync(teamId: string, actorId: string): Promise<SyncResult> {
    const db = this.repo.db;
    const link = await db.selectFrom('team_gitlab').selectAll().where('team_id', '=', teamId).executeTakeFirst();
    if (!link) throw new HttpError(409, 'Link a GitLab project on the Team page first.');
    const token = await this.auth.accessToken(actorId, link.origin, true);
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
        sprintByMilestone.set(String(m.id), { ...(await db.selectFrom('sprints').selectAll().where('id', '=', created.id).executeTakeFirstOrThrow()) });
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
    const stories = await db.selectFrom('stories').selectAll().where('team_id', '=', teamId).where('gitlab_iid', 'is not', null).execute();
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
      result.issuesUpdated++;
    }
    if (fresh.length) {
      const room = LIMITS.storiesPerTeam - Number((await db.selectFrom('stories').select((e) => e.fn.countAll<number>().as('n')).where('team_id', '=', teamId).executeTakeFirstOrThrow()).n);
      const take = fresh.slice(0, Math.max(0, room));
      if (take.length < fresh.length) result.partial = true;
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
        await db
          .updateTable('stories')
          .set({ gitlab_iid: issue.iid, gitlab_estimate: estimateFromIssue(issue.weight, issue.labels), gitlab_updated_at: issue.updated_at })
          .where('id', '=', story.id)
          .execute();
      }
      result.issuesCreated = created.length;
    }

    // ---- Sprintwell estimates → GitLab
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

    // ---- project events → activity log
    const after = (link.events_after ?? new Date(Date.parse(link.linked_at) - 14 * 86_400_000).toISOString()).slice(0, 10);
    const members = await db
      .selectFrom('memberships as m')
      .innerJoin('gitlab_accounts as g', 'g.user_id', 'm.user_id')
      .select(['m.user_id', 'g.gitlab_id'])
      .where('m.team_id', '=', teamId)
      .execute();
    const userByGitlab = new Map(members.map((m) => [m.gitlab_id, m.user_id]));
    const entries: ActivityEntry[] = [];
    let eventsPartial = false;
    let lastEventAt: string | null = null;
    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      // GitLab's "after" is a date and exclusive, so ask from the day before; duplicates are ignored.
      const day = new Date(Date.parse(`${after}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const { data, headers } = await gitlabApi<GlEvent[]>(this.gl, token, `/projects/${link.project_id}/events?after=${day}&per_page=${PER_PAGE}&page=${page}&sort=asc`, { what: 'read project activity' });
      for (const ev of data) {
        const entry = this.describeEvent(teamId, link.web_url, ev, userByGitlab);
        if (entry) entries.push(entry);
        if (!lastEventAt || ev.created_at > lastEventAt) lastEventAt = ev.created_at;
      }
      if (!headers.get('x-next-page')) break;
      if (page === MAX_EVENT_PAGES) eventsPartial = result.partial = true;
    }
    result.events = await logActivity(db, entries);

    // Cursors: continue where this sync stopped if it could not read everything.
    // (GitLab filters events by day, so a single day with more than 300 events cannot be read in full.)
    const lastIssue = issues[issues.length - 1];
    let issuesAfter = `${startedAt}|1`;
    if (issuesPartial && lastIssue) {
      const progressed = !issuesFrom || Date.parse(lastIssue.updated_at) - 60_000 > Date.parse(issuesFrom);
      issuesAfter = progressed ? `${lastIssue.updated_at}|1` : `${issuesFrom}|${lastPage + 1}`;
    }
    await db
      .updateTable('team_gitlab')
      .set({
        last_sync_at: startedAt,
        issues_after: issuesAfter,
        events_after: eventsPartial ? (lastEventAt ?? link.events_after) : startedAt,
      })
      .where('team_id', '=', teamId)
      .execute();
    return result;
  }

  private describeEvent(teamId: string, web: string, ev: GlEvent, userByGitlab: Map<string, string>): ActivityEntry | null {
    const username = ev.author?.username ?? ev.author_username ?? 'someone';
    const userId = userByGitlab.get(String(ev.author_id)) ?? null;
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
  async pushEstimate(teamId: string, storyId: string, actorId: string): Promise<boolean> {
    const db = this.repo.db;
    const link = await db.selectFrom('team_gitlab').selectAll().where('team_id', '=', teamId).executeTakeFirst();
    const story = await db.selectFrom('stories').selectAll().where('team_id', '=', teamId).where('id', '=', storyId).executeTakeFirst();
    if (!link || !story || story.gitlab_iid === null) return false;
    if ((story.estimate ?? null) === (story.gitlab_estimate ?? null)) return false;
    const token = await this.auth.accessToken(actorId, link.origin, true);
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
