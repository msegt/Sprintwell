import { KERTH_ATTRIBUTION, KERTH_PRIME_DIRECTIVE, LIMITS, type CharterItemDTO, type CharterKind } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { HowTo } from '../components/Guide';
import { Button, Icon, InlineEdit, formatDate } from '../components/ui';
import { PAGE_GUIDES } from '../content/guides';
import { api } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';

const SECTIONS: { kind: CharterKind; title: string; intro: string; placeholder: string }[] = [
  {
    kind: 'agreement',
    title: 'Working agreement',
    intro: 'How we work together. A living document: review it at every retrospective. Include communication norms, decision-making, conflict resolution, code review and Git workflow.',
    placeholder: 'e.g. We reply to merge-request reviews within one working day',
  },
  {
    kind: 'dor',
    title: 'Definition of Ready',
    intro: 'When a story can enter a sprint. Each story in the backlog can be checked against this list.',
    placeholder: 'e.g. Acceptance criteria are defined',
  },
  {
    kind: 'dod',
    title: 'Definition of Done',
    intro: 'The quality bar every increment must meet before it counts as done.',
    placeholder: 'e.g. Reviewed by at least one teammate',
  },
];

export function CharterPage() {
  const { snap } = useTeam();
  usePageTitle('Team charter');
  const lastUpdated = snap.charter.reduce((a, c) => (c.updatedAt > a ? c.updatedAt : a), '');
  return (
    <div className="page stack">
      <div className="row between wrap">
        <div>
          <h1>Team charter</h1>
          {lastUpdated && <p className="small muted">Last changed {formatDate(lastUpdated)}</p>}
        </div>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="no-print">
        <HowTo id="charter" guide={PAGE_GUIDES.charter} />
      </div>
      <blockquote className="prime-directive">
        <p>{KERTH_PRIME_DIRECTIVE}</p>
        <footer>The Retrospective Prime Directive, {KERTH_ATTRIBUTION}</footer>
      </blockquote>
      <div className="grid-3">
        {SECTIONS.map((s) => (
          <CharterSection key={s.kind} section={s} items={snap.charter.filter((c) => c.kind === s.kind).sort((a, b) => a.position - b.position)} />
        ))}
      </div>
    </div>
  );
}

function CharterSection({ section, items }: { section: (typeof SECTIONS)[number]; items: CharterItemDTO[] }) {
  const { teamId } = useTeam();
  const run = useAction();
  const [text, setText] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(() => api('POST', `/api/teams/${teamId}/charter`, { kind: section.kind, text: text.trim() }))) setText('');
  };
  const move = (i: number, delta: number) => {
    const ids = items.map((x) => x.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api('POST', `/api/teams/${teamId}/charter/reorder`, { ids }));
  };
  const headingId = `charter-${section.kind}`;
  return (
    <section className="card charter-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{section.title}</h2>
      <p className="small muted">{section.intro}</p>
      <ol className="charter-list">
        {items.map((item, i) => (
          <li key={item.id}>
            <InlineEdit label={`${section.title} item`} value={item.text} maxLength={LIMITS.shortText} onSave={(v) => run(() => api('PATCH', `/api/teams/${teamId}/charter/${item.id}`, { text: v }))} />
            <span className="item-tools no-print">
              <button type="button" className="icon-btn" aria-label={`Move up: ${item.text}`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move down: ${item.text}`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <Icon name="down" size={14} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Remove: ${item.text}`} onClick={() => run(() => api('DELETE', `/api/teams/${teamId}/charter/${item.id}`))}>
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <form onSubmit={add} className="inline-form no-print">
        <label className="sr-only" htmlFor={`${headingId}-new`}>
          Add to {section.title}
        </label>
        <input id={`${headingId}-new`} className="input" value={text} maxLength={LIMITS.shortText} onChange={(e) => setText(e.target.value)} placeholder={section.placeholder} />
        <Button type="submit" small>
          Add
        </Button>
      </form>
    </section>
  );
}
