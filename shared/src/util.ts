import { cardToNumber } from './decks';
import type { CapacityRow, CharterItemDTO, SprintDTO, StoryDTO } from './types';
import { INVEST } from './constants';

/** Focus hours available in a sprint, e.g. 10 days × 6 h × 70 % = 42 h. */
export function capacityHours(rows: CapacityRow[]): number {
  const total = rows.reduce((sum, r) => sum + r.daysAvailable * r.hoursPerDay * (r.focusPercent / 100), 0);
  return Math.round(total * 10) / 10;
}

/** Sum of numeric estimates. Non-numeric estimates (T-shirt sizes, "?") are ignored. */
export function points(stories: Pick<StoryDTO, 'estimate'>[]): number {
  return stories.reduce((sum, s) => sum + (s.estimate ? (cardToNumber(s.estimate) ?? 0) : 0), 0);
}

/** Points completed per closed sprint, most recent first. */
export function velocityHistory(sprints: SprintDTO[], stories: StoryDTO[]): { sprint: SprintDTO; points: number }[] {
  return sprints
    .filter((s) => s.status === 'closed')
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
    .map((sprint) => ({
      sprint,
      points: points(stories.filter((st) => st.sprintId === sprint.id && st.status === 'done')),
    }));
}

/** Average velocity across the last `n` closed sprints, or null if there are none. */
export function averageVelocity(sprints: SprintDTO[], stories: StoryDTO[], n = 3): number | null {
  const history = velocityHistory(sprints, stories).slice(0, n);
  if (history.length === 0) return null;
  return Math.round((history.reduce((a, h) => a + h.points, 0) / history.length) * 10) / 10;
}

export function dorItems(charter: CharterItemDTO[]): CharterItemDTO[] {
  return charter.filter((c) => c.kind === 'dor').sort((a, b) => a.position - b.position);
}

/** A story is Ready when every Definition of Ready item is ticked. */
export function isReady(story: StoryDTO, charter: CharterItemDTO[]): boolean {
  const items = dorItems(charter);
  return items.length > 0 && items.every((i) => story.dor[i.id] === true);
}

export function investScore(story: StoryDTO): number {
  return INVEST.filter((i) => story.invest[i.key]).length;
}

export function storySentence(s: Pick<StoryDTO, 'asA' | 'iWant' | 'soThat'>): string {
  if (!s.asA && !s.iWant && !s.soThat) return '';
  return `As ${withArticle(s.asA)}, I want ${s.iWant || '…'}${s.soThat ? `, so that ${s.soThat}` : ''}.`;
}

function withArticle(role: string): string {
  if (!role) return 'a …';
  if (/^(a|an|the)\s/i.test(role)) return role;
  return /^[aeiou]/i.test(role) ? `an ${role}` : `a ${role}`;
}

/**
 * Ideal and actual burndown for a sprint, one point per day (inclusive).
 * Remaining work is measured in story points using `doneAt` timestamps.
 */
export function burndown(
  sprint: SprintDTO,
  stories: StoryDTO[],
  today = new Date(),
): { date: string; ideal: number; remaining: number | null }[] {
  if (!sprint.startDate || !sprint.endDate) return [];
  const start = new Date(`${sprint.startDate}T00:00:00Z`);
  const end = new Date(`${sprint.endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days < 0 || days > 120) return [];
  const inSprint = stories.filter((s) => s.sprintId === sprint.id);
  const total = points(inSprint);
  const out: { date: string; ideal: number; remaining: number | null }[] = [];
  for (let d = 0; d <= days; d++) {
    const date = new Date(start.getTime() + d * 86_400_000);
    const dayEnd = date.getTime() + 86_400_000;
    const iso = date.toISOString().slice(0, 10);
    const ideal = days === 0 ? 0 : Math.round(total * (1 - d / days) * 10) / 10;
    const remaining =
      date.getTime() > today.getTime()
        ? null
        : total - points(inSprint.filter((s) => s.doneAt && new Date(s.doneAt).getTime() < dayEnd));
    out.push({ date: iso, ideal, remaining });
  }
  return out;
}

export function riskScore(likelihood: number, impact: number): number {
  return likelihood * impact;
}

export function riskBand(score: number): 'low' | 'medium' | 'high' {
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export const LEVEL_NAMES = ['', 'Low', 'Medium', 'High'] as const;
