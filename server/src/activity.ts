import type { ActivityDTO, ActivityKind } from '@sprintwell/shared';
import type { Db } from './db';
import { newId, now } from './util';

export interface ActivityEntry {
  teamId: string;
  userId: string | null;
  kind: ActivityKind;
  summary: string;
  url?: string;
  source?: 'sprintwell' | 'gitlab';
  /** When set, the entry is recorded only once (e.g. one "voted" per item and round). */
  dedupe?: string;
  /** Defaults to now; GitLab events keep their own time. */
  at?: string;
}

const MAX_SUMMARY = 300;

/**
 * Records what people did, for the team itself and its teaching staff.
 * Logging must never break the action being logged, so failures are swallowed.
 */
export async function logActivity(db: Db, entries: ActivityEntry | ActivityEntry[]): Promise<number> {
  const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e.summary.trim());
  let written = 0;
  for (let i = 0; i < list.length; i += 10) {
    const rows = list.slice(i, i + 10).map((e) => ({
      id: newId(),
      team_id: e.teamId,
      user_id: e.userId,
      at: e.at ?? now(),
      source: e.source ?? 'sprintwell',
      kind: e.kind,
      summary: e.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY),
      url: e.url ?? '',
      dedupe: e.dedupe ?? null,
    }));
    try {
      const r = await db
        .insertInto('activity')
        .values(rows)
        .onConflict((oc) => oc.column('dedupe').doNothing())
        .executeTakeFirst();
      written += Number(r.numInsertedOrUpdatedRows ?? rows.length);
    } catch (err) {
      console.warn('activity log failed', err);
    }
  }
  return written;
}

export async function listActivity(db: Db, teamId: string, filter: { userId?: string; kind?: string; before?: string; limit: number }): Promise<ActivityDTO[]> {
  let q = db.selectFrom('activity').selectAll().where('team_id', '=', teamId);
  if (filter.userId) q = q.where('user_id', '=', filter.userId);
  if (filter.kind) q = filter.kind === 'gitlab' ? q.where('source', '=', 'gitlab') : q.where('kind', '=', filter.kind);
  if (filter.before) q = q.where('at', '<', filter.before);
  const rows = await q.orderBy('at', 'desc').orderBy('id', 'desc').limit(filter.limit).execute();
  return rows.map((r) => ({ id: r.id, at: r.at, userId: r.user_id, source: r.source as ActivityDTO['source'], kind: r.kind as ActivityKind, summary: r.summary, url: r.url }));
}

/** Counts per person and kind, e.g. for a class overview. */
export async function activityCounts(db: Db, teamIds: string[], since?: string): Promise<{ teamId: string; userId: string | null; kind: string; n: number; last: string }[]> {
  const out: { teamId: string; userId: string | null; kind: string; n: number; last: string }[] = [];
  for (let i = 0; i < teamIds.length; i += 50) {
    let q = db
      .selectFrom('activity')
      .select(['team_id', 'user_id', 'kind'])
      .select((e) => [e.fn.countAll<number>().as('n'), e.fn.max<string>('at').as('last')])
      .where('team_id', 'in', teamIds.slice(i, i + 50));
    if (since) q = q.where('at', '>=', since);
    const rows = await q.groupBy(['team_id', 'user_id', 'kind']).execute();
    for (const r of rows) out.push({ teamId: r.team_id, userId: r.user_id, kind: r.kind, n: Number(r.n), last: r.last });
  }
  return out;
}
