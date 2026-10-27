/**
 * Mapping between GitLab issues and Sprintwell backlog items.
 *
 * Issues are expected to follow the usual convention: a short title, and a
 * description with the story ("As a…, I want…, so that…") and an
 * "Acceptance criteria" list. Anything else in the description becomes notes.
 */

export const ESTIMATE_LABEL_PREFIX = 'points::';

export interface ParsedIssue {
  asA: string;
  iWant: string;
  soThat: string;
  acceptanceCriteria: string[];
  notes: string;
}

const STORY = /\bAs an?\s+(.+?),?\s+I\s+want\s+(.+?),?\s+so\s+that\s+(.+?)(?:\.\s|\.$|\n|$)/is;
const AC_HEADING = /^\s*(?:#{1,6}\s*|\*\*)?\s*acceptance\s+criteria\b.*$/im;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;

function clean(s: string): string {
  return s
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIssueDescription(description: string | null | undefined): ParsedIssue {
  let text = (description ?? '').replace(/\r\n/g, '\n');
  const out: ParsedIssue = { asA: '', iWant: '', soThat: '', acceptanceCriteria: [], notes: '' };

  const story = STORY.exec(text);
  if (story) {
    out.asA = clean(story[1]!).replace(/^(a|an)\s+/i, '');
    out.iWant = clean(story[2]!);
    out.soThat = clean(story[3]!).replace(/\.$/, '');
    text = text.replace(story[0], story[0].endsWith('\n') ? '\n' : ' ');
  }

  const heading = AC_HEADING.exec(text);
  if (heading) {
    const lines = text.slice(heading.index + heading[0].length).split('\n');
    let i = 0;
    // The heading line itself ends here; skip blank lines before the list.
    while (i < lines.length && lines[i]!.trim() === '') i++;
    while (i < lines.length) {
      const item = LIST_ITEM.exec(lines[i]!);
      if (!item) break;
      out.acceptanceCriteria.push(clean(item[1]!));
      i++;
    }
    const used = heading[0].length + lines.slice(0, i).join('\n').length;
    text = text.slice(0, heading.index) + text.slice(heading.index + used);
  }

  out.acceptanceCriteria = out.acceptanceCriteria.filter(Boolean).slice(0, 50);
  out.notes = text.replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
  return out;
}

/** The estimate stored on a GitLab issue: its weight, or a "points::5" label. */
export function estimateFromIssue(weight: number | null | undefined, labels: string[] | undefined): string | null {
  if (typeof weight === 'number') return String(weight);
  for (const l of labels ?? []) {
    const m = /^(?:points|estimate|story\s*points|sp)\s*::?\s*(.+)$/i.exec(l.trim());
    if (m) return m[1]!.trim().slice(0, 10);
  }
  return null;
}

/** Labels to remove before adding a new estimate label. */
export function estimateLabels(labels: string[] | undefined): string[] {
  return (labels ?? []).filter((l) => /^(?:points|estimate|story\s*points|sp)\s*::?/i.test(l.trim()));
}
