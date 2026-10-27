import { INVEST, ITEM_KINDS, LIMITS, dorItems, getDeck, readinessProblems, shouldSplit, storySentence, type StoryDTO, type TaskDTO } from '@sprintwell/shared';
import '../styles/ready.css';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAction, useNotice, useTeam } from '../lib/hooks';
import { Badge, Button, ConfirmButton, Field, Icon, Modal } from './ui';

type Draft = Omit<StoryDTO, 'id' | 'position' | 'createdAt' | 'updatedAt' | 'doneAt' | 'gitlabIid'>;

const blank = (sprintId: string | null = null): Draft => ({
  sprintId,
  kind: 'story',
  title: '',
  asA: '',
  iWant: '',
  soThat: '',
  acceptanceCriteria: [],
  notes: '',
  estimate: null,
  status: sprintId ? 'todo' : 'backlog',
  invest: {},
  dor: {},
  externalUrl: '',
  tasks: [],
  ownerId: null,
});

const tempId = () => Math.random().toString(36).slice(2, 10);

export function StoryEditor({ story, onClose, defaultSprintId }: { story: StoryDTO | null; onClose(): void; defaultSprintId?: string | null }) {
  const { snap, teamId } = useTeam();
  const run = useAction();
  const { notify } = useNotice();
  const [d, setD] = useState<Draft>(() => (story ? { ...story } : blank(defaultSprintId ?? null)));
  const [newAc, setNewAc] = useState('');
  const [newTask, setNewTask] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const deck = getDeck(snap.team.settings.defaultDeck).cards.filter((c) => c !== '☕');
  const dor = dorItems(snap.charter);
  const sentence = storySentence(d);
  const enforce = snap.team.settings.enforceReady;
  const problems = readinessProblems({ ...d, acceptanceCriteria: newAc.trim() ? [...d.acceptanceCriteria, newAc.trim()] : d.acceptanceCriteria }, snap.charter);
  const movingIntoSprint = !!d.sprintId && d.sprintId !== (story?.sprintId ?? null);
  const blocked = enforce && movingIntoSprint && problems.length > 0;
  const isStory = d.kind === 'story';

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const body = { ...d, acceptanceCriteria: newAc.trim() ? [...d.acceptanceCriteria, newAc.trim()] : d.acceptanceCriteria };
    setBusy(true);
    const ok = await run(() => (story ? api('PATCH', `/api/teams/${teamId}/stories/${story.id}`, body) : api('POST', `/api/teams/${teamId}/stories`, body)), story ? 'Story saved' : 'Story added');
    setBusy(false);
    const gitlabError = ok && typeof ok === 'object' && 'gitlabError' in ok ? String((ok as { gitlabError: unknown }).gitlabError) : null;
    if (gitlabError) notify(`Saved in Sprintwell, but the estimate did not reach GitLab: ${gitlabError} Sync with GitLab later to try again.`, 'error');
    if (ok) onClose();
  };

  const addTask = () => {
    if (!newTask.trim()) return;
    set('tasks', [...d.tasks, { id: tempId(), text: newTask.trim(), done: false, ownerId: null }]);
    setNewTask('');
  };
  const updateTask = (id: string, patch: Partial<TaskDTO>) => set('tasks', d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <Modal open onClose={onClose} title={story ? 'Edit story' : 'New user story'} wide>
      <form onSubmit={save} className="story-form">
        <div className="story-main stack">
          <Field label="Short name" hint="A few words, as you would use for the issue title.">
            {(id, h) => <input id={id} aria-describedby={h} className="input" required maxLength={LIMITS.title} value={d.title} onChange={(e) => set('title', e.target.value)} />}
          </Field>
          <Field label="Type" hint="Bugs, spikes and technical tasks do not need the user story format or INVEST, but must still meet your Definition of Ready.">
            {(id, h) => (
              <select id={id} aria-describedby={h} className="input" value={d.kind} onChange={(e) => set('kind', e.target.value as Draft['kind'])}>
                {ITEM_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <fieldset className="story-sentence">
            <legend>User story{!isStory && <span className="hint"> (optional for this type)</span>}</legend>
            <div className="sentence-grid">
              <label>
                As a
                <input className="input" maxLength={LIMITS.shortText} value={d.asA} onChange={(e) => set('asA', e.target.value)} placeholder="student" />
              </label>
              <label>
                I want
                <input className="input" maxLength={LIMITS.shortText} value={d.iWant} onChange={(e) => set('iWant', e.target.value)} placeholder="to check my grades online" />
              </label>
              <label>
                so that
                <input className="input" maxLength={LIMITS.shortText} value={d.soThat} onChange={(e) => set('soThat', e.target.value)} placeholder="I can track my progress" />
              </label>
            </div>
            {sentence && <p className="sentence-preview">{sentence}</p>}
            {!d.soThat && (d.asA || d.iWant) && <p className="hint">Tip: the “so that” makes the value explicit, which helps the V in INVEST.</p>}
          </fieldset>

          <fieldset>
            <legend>Acceptance criteria</legend>
            <p className="hint">Testable conditions, e.g. “Given I am logged in, when I open Grades, then I see this term’s marks.”</p>
            <ul className="plain-list ac-list">
              {d.acceptanceCriteria.map((c, i) => (
                <li key={i} className="row between">
                  <span>{c}</span>
                  <button type="button" className="icon-btn" aria-label={`Remove criterion: ${c}`} onClick={() => set('acceptanceCriteria', d.acceptanceCriteria.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <div className="inline-form">
              <label className="sr-only" htmlFor="new-ac">
                New acceptance criterion
              </label>
              <input
                id="new-ac"
                className="input"
                maxLength={LIMITS.shortText}
                value={newAc}
                onChange={(e) => setNewAc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newAc.trim()) {
                      set('acceptanceCriteria', [...d.acceptanceCriteria, newAc.trim()]);
                      setNewAc('');
                    }
                  }
                }}
                placeholder="Given… when… then…"
              />
              <Button
                small
                onClick={() => {
                  if (newAc.trim()) {
                    set('acceptanceCriteria', [...d.acceptanceCriteria, newAc.trim()]);
                    setNewAc('');
                  }
                }}
              >
                Add
              </Button>
            </div>
          </fieldset>

          <fieldset>
            <legend>Tasks</legend>
            <ul className="plain-list">
              {d.tasks.map((t) => (
                <li key={t.id} className="row between wrap">
                  <label className="check">
                    <input type="checkbox" checked={t.done} onChange={(e) => updateTask(t.id, { done: e.target.checked })} />
                    <span className={t.done ? 'done-text' : ''}>{t.text}</span>
                  </label>
                  <span className="row">
                    <label className="sr-only" htmlFor={`owner-${t.id}`}>
                      Owner of {t.text}
                    </label>
                    <select id={`owner-${t.id}`} className="input input-small" value={t.ownerId ?? ''} onChange={(e) => updateTask(t.id, { ownerId: e.target.value || null })}>
                      <option value="">No owner</option>
                      {snap.team.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="icon-btn" aria-label={`Remove task: ${t.text}`} onClick={() => set('tasks', d.tasks.filter((x) => x.id !== t.id))}>
                      <Icon name="trash" size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="inline-form">
              <label className="sr-only" htmlFor="new-task">
                New task
              </label>
              <input
                id="new-task"
                className="input"
                maxLength={LIMITS.shortText}
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTask();
                  }
                }}
                placeholder="e.g. Write the API endpoint"
              />
              <Button small onClick={addTask}>
                Add task
              </Button>
            </div>
          </fieldset>

          <Field label="Notes">{(id) => <textarea id={id} className="input" rows={3} maxLength={LIMITS.longText} value={d.notes} onChange={(e) => set('notes', e.target.value)} />}</Field>
        </div>

        <aside className="story-side stack">
          {enforce && (
            <div className={`ready-panel ${problems.length ? 'not-ready' : 'is-ready'}`} role="status">
              {problems.length === 0 ? (
                <p>
                  <Icon name="check" size={16} /> <strong>Ready for a sprint.</strong>
                </p>
              ) : (
                <>
                  <p>
                    <strong>{blocked ? 'Cannot go into the sprint yet.' : 'Not ready for a sprint yet.'}</strong>{' '}
                    {blocked ? 'Fix these first, or keep it in the Product Backlog:' : 'It can stay in the Product Backlog while you refine it.'}
                  </p>
                  <ul className="small">
                    {problems.map((p) => (
                      <li key={p.code}>{p.message}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="row wrap">
            <Field label="Estimate">
              {(id) => (
                <select id={id} className="input" value={d.estimate ?? ''} onChange={(e) => set('estimate', e.target.value || null)}>
                  <option value="">Not estimated</option>
                  {[...new Set([...deck, ...(d.estimate ? [d.estimate] : [])])].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Status">
              {(id) => (
                <select id={id} className="input" value={d.status} onChange={(e) => set('status', e.target.value as Draft['status'])}>
                  <option value="backlog">Backlog</option>
                  <option value="todo">To do</option>
                  <option value="doing">In progress</option>
                  <option value="done">Done</option>
                </select>
              )}
            </Field>
          </div>
          {shouldSplit(d.estimate, snap.team.settings.splitThreshold) && (
            <p className="callout warn small" role="note">
              This is a large story. Consider splitting it so it fits in a day or two (the S in INVEST).
            </p>
          )}
          <Field label="Sprint">
            {(id) => (
              <select id={id} className="input" value={d.sprintId ?? ''} onChange={(e) => set('sprintId', e.target.value || null)}>
                <option value="">Product Backlog (no sprint)</option>
                {snap.sprints
                  .filter((s) => s.status !== 'closed' || s.id === d.sprintId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label="Owner">
            {(id) => (
              <select id={id} className="input" value={d.ownerId ?? ''} onChange={(e) => set('ownerId', e.target.value || null)}>
                <option value="">No owner</option>
                {snap.team.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Issue link" hint="Link to the GitLab, GitHub or Jira issue, if there is one.">
            {(id, h) => <input id={id} aria-describedby={h} type="url" className="input" maxLength={500} value={d.externalUrl} onChange={(e) => set('externalUrl', e.target.value)} placeholder="https://" />}
          </Field>

          <fieldset className="checklist">
            <legend>
              INVEST check{!isStory && <span className="hint"> (user stories only)</span>} <Badge tone={INVEST.every((i) => d.invest[i.key]) ? 'good' : 'neutral'}>{INVEST.filter((i) => d.invest[i.key]).length}/6</Badge>
            </legend>
            {INVEST.map((i) => (
              <label key={i.key} className="check">
                <input type="checkbox" checked={!!d.invest[i.key]} onChange={(e) => set('invest', { ...d.invest, [i.key]: e.target.checked })} />
                <span>
                  <strong>{i.name}</strong>
                  <span className="hint block">{i.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="checklist">
            <legend>
              Definition of Ready{' '}
              {dor.length > 0 && <Badge tone={dor.every((x) => d.dor[x.id]) ? 'good' : 'neutral'}>{dor.every((x) => d.dor[x.id]) ? 'Ready' : `${dor.filter((x) => d.dor[x.id]).length}/${dor.length}`}</Badge>}
            </legend>
            {dor.length === 0 ? (
              <p className="hint">Your team has no Definition of Ready yet. Add one on the Charter page.</p>
            ) : (
              dor.map((x) => (
                <label key={x.id} className="check">
                  <input type="checkbox" checked={!!d.dor[x.id]} onChange={(e) => set('dor', { ...d.dor, [x.id]: e.target.checked })} />
                  {x.text}
                </label>
              ))
            )}
          </fieldset>
        </aside>

        <div className="row between story-actions">
          {story ? (
            <ConfirmButton
              confirmLabel="Delete this story"
              onConfirm={async () => {
                if (await run(() => api('DELETE', `/api/teams/${teamId}/stories/${story.id}`), 'Story deleted')) onClose();
              }}
            >
              Delete
            </ConfirmButton>
          ) : (
            <span />
          )}
          <div className="row wrap end">
            {blocked && <span className="small warn-text">Not ready for the sprint. Set Sprint to “Product Backlog” to save it there.</span>}
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" busy={busy} disabled={blocked} title={blocked ? 'Not ready for the sprint: see the list at the top right' : undefined}>
              {story ? 'Save' : 'Add story'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
