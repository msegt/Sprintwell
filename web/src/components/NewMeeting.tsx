import { CHECKIN_QUESTIONS, DECKS, MEETING_INFO, MEETING_KINDS, RETRO_TEMPLATES, type MeetingKind } from '@sprintwell/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { MEETING_GUIDES } from '../content/guides';
import { api } from '../lib/api';
import { useAction, useTeam } from '../lib/hooks';
import { Button, Field, Modal } from './ui';

export const KIND_ORDER: MeetingKind[] = ['planning', 'daily', 'review', 'retro', 'poker', 'pairing'];

/** Icon for each kind of event (see the Icon component). */
export const KIND_ICON: Record<MeetingKind, string> = {
  planning: 'calendar',
  daily: 'sun',
  review: 'present',
  retro: 'loop',
  poker: 'cards',
  pairing: 'pair',
};

export function NewMeetingDialog({ kind, open, onClose, presetStoryIds }: { kind: MeetingKind | null; open: boolean; onClose(): void; presetStoryIds?: string[] }) {
  const { snap, teamId, me } = useTeam();
  const navigate = useNavigate();
  const run = useAction();
  const [current, setCurrent] = useState<MeetingKind>(kind ?? 'retro');
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(RETRO_TEMPLATES[0]!.id);
  const [customCols, setCustomCols] = useState(['', '', '']);
  const [anonymous, setAnonymous] = useState(true);
  const [question, setQuestion] = useState(CHECKIN_QUESTIONS[0]!);
  const [deckId, setDeckId] = useState(snap.team.settings.defaultDeck);
  const [autoReveal, setAutoReveal] = useState(false);
  const [storyIds, setStoryIds] = useState<string[]>(presetStoryIds ?? []);
  const [perPerson, setPerPerson] = useState(90);
  const [sprintId, setSprintId] = useState<string>('');
  const [participants, setParticipants] = useState<string[]>([me.id]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent(kind ?? 'retro');
    setTitle('');
    setStoryIds(presetStoryIds ?? []);
    const active = snap.sprints.find((s) => s.status === 'active');
    const planned = snap.sprints.find((s) => s.status === 'planned');
    if (kind === 'planning') setSprintId(planned?.id ?? '');
    else setSprintId(active?.id ?? '');
    // Reset only when the dialog opens.
  }, [open, kind]);

  const backlog = useMemo(() => snap.stories.filter((s) => s.status !== 'done').sort((a, b) => Number(!!a.estimate) - Number(!!b.estimate) || a.position - b.position), [snap.stories]);
  const sprintChoices = snap.sprints.filter((s) => (current === 'planning' ? s.status === 'planned' : s.status !== 'planned'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const options: Record<string, unknown> = {};
    if (current === 'retro') {
      options.templateId = templateId;
      options.anonymous = anonymous;
      options.checkinQuestion = question;
      if (templateId === 'custom') options.columns = customCols.filter((c) => c.trim()).map((title) => ({ title, prompt: '' }));
    }
    if (current === 'poker') Object.assign(options, { deckId, autoReveal, storyIds });
    if (current === 'daily') options.perPersonSeconds = perPerson;
    if (current === 'pairing') options.participants = participants;
    if (current === 'retro' && templateId === 'custom' && !customCols.some((c) => c.trim())) return;
    setBusy(true);
    const r = await run(() =>
      api<{ meetingId: string }>('POST', `/api/teams/${teamId}/meetings`, {
        kind: current,
        title: title.trim() || undefined,
        sprintId: ['planning', 'review'].includes(current) && sprintId ? sprintId : current === 'retro' || current === 'daily' ? (snap.sprints.find((s) => s.status === 'active')?.id ?? null) : null,
        options,
      }),
    );
    setBusy(false);
    if (r) {
      onClose();
      navigate(`/t/${teamId}/m/${r.meetingId}`);
    }
  };

  const info = MEETING_INFO[current];
  return (
    <Modal open={open} onClose={onClose} title={`Start: ${info.name}`} wide>
      <form onSubmit={submit} className="stack">
        {!kind && (
          <Field label="Event">
            {(id) => (
              <select id={id} className="input" value={current} onChange={(e) => setCurrent(e.target.value as MeetingKind)}>
                {MEETING_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {MEETING_INFO[k].name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <p className="muted">
          {info.summary} <span className="small">Timebox: {info.timebox}</span>
        </p>
        {MEETING_GUIDES[current].prepare && (
          <details className="guide-more">
            <summary>Before you start: a quick checklist</summary>
            <ul className="guide-tips">
              {MEETING_GUIDES[current].prepare!.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="small">
              <Link to={`/guide#event-${current}`} target="_blank" rel="noopener">
                Full guide for {info.name}
                <span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </p>
          </details>
        )}

        {current === 'retro' && (
          <>
            <fieldset className="template-picker">
              <legend>Format</legend>
              <p className="hint">Vary the format so retrospectives don’t go stale.</p>
              <div className="template-grid">
                {[...RETRO_TEMPLATES, { id: 'custom', name: 'Custom', description: 'Choose your own columns.', whenToUse: 'When none of the others fit.', columns: [] }].map((t) => (
                  <label key={t.id} className={`template-option${templateId === t.id ? ' selected' : ''}`}>
                    <input type="radio" name="template" value={t.id} checked={templateId === t.id} onChange={() => setTemplateId(t.id)} />
                    <span className="template-name">{t.name}</span>
                    <span className="small">{t.description}</span>
                    <span className="small muted">Good for: {t.whenToUse}</span>
                    {t.columns.length > 0 && <span className="template-cols">{t.columns.map((c) => c.title).join(' · ')}</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            {templateId === 'custom' && (
              <fieldset>
                <legend>Columns</legend>
                {customCols.map((c, i) => (
                  <input
                    key={i}
                    className="input"
                    aria-label={`Column ${i + 1}`}
                    placeholder={`Column ${i + 1}`}
                    maxLength={40}
                    value={c}
                    onChange={(e) => setCustomCols(customCols.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                ))}
                {customCols.length < 6 && (
                  <Button small onClick={() => setCustomCols([...customCols, ''])}>
                    Add column
                  </Button>
                )}
              </fieldset>
            )}
            <Field label="Check-in question">
              {(id) => (
                <>
                  <input id={id} className="input" list="checkin-questions" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} />
                  <datalist id="checkin-questions">
                    {CHECKIN_QUESTIONS.map((q) => (
                      <option key={q} value={q} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <label className="check">
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              Anonymous cards (recommended: helps psychological safety)
            </label>
          </>
        )}

        {current === 'poker' && (
          <>
            <Field label="Deck">
              {(id) => (
                <select id={id} className="input" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  {DECKS.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}: {d.cards.join(' ')}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <label className="check">
              <input type="checkbox" checked={autoReveal} onChange={(e) => setAutoReveal(e.target.checked)} />
              Reveal automatically when everyone has voted
            </label>
            <fieldset>
              <legend>Stories to estimate</legend>
              <p className="hint">Unestimated stories are listed first. You can also add stories during the session.</p>
              {backlog.length === 0 ? (
                <p className="muted small">The backlog is empty. You can type stories in during the session.</p>
              ) : (
                <div className="check-list">
                  {backlog.map((s) => (
                    <label key={s.id} className="check">
                      <input type="checkbox" checked={storyIds.includes(s.id)} onChange={(e) => setStoryIds(e.target.checked ? [...storyIds, s.id] : storyIds.filter((x) => x !== s.id))} />
                      {s.title} {s.estimate && <span className="muted small">(currently {s.estimate})</span>}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </>
        )}

        {current === 'daily' && (
          <Field label="Time per person (seconds)" hint="The whole Daily Scrum is timeboxed to 15 minutes.">
            {(id, d) => <input id={id} aria-describedby={d} type="number" className="input input-short" min={15} max={600} step={15} value={perPerson} onChange={(e) => setPerPerson(Number(e.target.value))} />}
          </Field>
        )}

        {(current === 'planning' || current === 'review') && (
          <Field label="Sprint">
            {(id) => (
              <select id={id} className="input" value={sprintId} onChange={(e) => setSprintId(e.target.value)} required={current === 'review'}>
                {current === 'planning' && <option value="">Create the next sprint</option>}
                {current === 'review' && sprintChoices.length === 0 && <option value="">No sprint yet</option>}
                {sprintChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.status})
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        {current === 'pairing' && (
          <fieldset>
            <legend>Who is pairing?</legend>
            <div className="check-list">
              {snap.team.members.map((m) => (
                <label key={m.userId} className="check">
                  <input
                    type="checkbox"
                    checked={participants.includes(m.userId)}
                    onChange={(e) => setParticipants(e.target.checked ? [...participants, m.userId] : participants.filter((x) => x !== m.userId))}
                  />
                  {m.displayName}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <Field label="Title (optional)">{(id) => <input id={id} className="input" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>

        <div className="row end">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={(current === 'review' && !sprintId) || (current === 'pairing' && participants.length === 0)}>
            Start
          </Button>
        </div>
      </form>
    </Modal>
  );
}
