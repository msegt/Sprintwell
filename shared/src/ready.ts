import { INVEST } from './constants';
import type { CharterItemDTO, StoryDTO } from './types';
import { dorItems } from './util';

export const ITEM_KINDS = [
  { id: 'story', name: 'User story' },
  { id: 'bug', name: 'Bug' },
  { id: 'spike', name: 'Spike' },
  { id: 'task', name: 'Technical task' },
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number]['id'];

export interface ReadinessProblem {
  /** Stable code for tests and styling. */
  code: 'format' | 'acceptance' | 'invest' | 'dor-missing' | 'dor';
  message: string;
}

type Checkable = Pick<StoryDTO, 'kind' | 'asA' | 'iWant' | 'soThat' | 'acceptanceCriteria' | 'invest' | 'dor'>;

/**
 * What stops a backlog item from entering a sprint.
 *
 * User stories need the "As a… I want… so that…" format, at least one
 * acceptance criterion, all six INVEST checks and every Definition of Ready
 * item. Bugs, spikes and technical tasks only need the Definition of Ready.
 * The checks can only see what the team ticked and wrote, not whether it is true.
 */
export function readinessProblems(item: Checkable, charter: CharterItemDTO[]): ReadinessProblem[] {
  const problems: ReadinessProblem[] = [];
  if (item.kind === 'story') {
    const missing = [!item.asA.trim() && '“As a…”', !item.iWant.trim() && '“I want…”', !item.soThat.trim() && '“so that…”'].filter(Boolean);
    if (missing.length) problems.push({ code: 'format', message: `Write it as a user story: fill in ${missing.join(', ')}.` });
    if (item.acceptanceCriteria.length === 0) problems.push({ code: 'acceptance', message: 'Add at least one acceptance criterion.' });
    const notTicked = INVEST.filter((i) => !item.invest[i.key]).map((i) => i.name);
    if (notTicked.length) problems.push({ code: 'invest', message: `Check it against INVEST. Not ticked yet: ${notTicked.join(', ')}.` });
  }
  const dor = dorItems(charter);
  if (dor.length === 0) {
    problems.push({ code: 'dor-missing', message: 'Your team has no Definition of Ready yet. Agree one on the Charter page first.' });
  } else {
    const open = dor.filter((d) => item.dor[d.id] !== true).map((d) => `“${d.text}”`);
    if (open.length) problems.push({ code: 'dor', message: `Definition of Ready not met. Not ticked yet: ${open.join(', ')}.` });
  }
  return problems;
}
