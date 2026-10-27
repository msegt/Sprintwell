import { LIMITS, averageVelocity, capacityHours, dorItems, investScore, isReady, points, type CapacityRow, type PlanningView, type StoryDTO } from '@sprintwell/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useReadyGate } from '../components/ReadyGate';
import { StoryEditor } from '../components/StoryEditor';
import { Badge, Button, Empty, Field, Icon } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useTeam } from '../lib/hooks';
import { useRoom } from './MeetingPage';

export function PlanningRoom() {
  const { view } = useRoom();
  const { snap } = useTeam();
  const sprint = snap.sprints.find((s) => s.id === view.sprintId);
  if (!sprint) return <Empty title="This sprint was deleted" />;
  switch (view.phase) {
    case 'why':
      return <Why />;
    case 'what':
      return <What />;
    case 'how':
      return <How />;
    default:
      return <Commit />;
  }
}

function useSprint() {
  const { view } = useRoom();
  const { snap } = useTeam();
  const sprint = snap.sprints.find((s) => s.id === view.sprintId)!;
  const stories = snap.stories.filter((s) => s.sprintId === sprint.id);
  return { sprint, stories };
}

function Why() {
  const { sprint } = useSprint();
  const { teamId } = useTeam();
  const run = useAction();
  const { ended } = useRoom();
  return (
    <div className="grid-2">
      <section className="card stack" aria-labelledby="goal-h">
        <h2 id="goal-h">Why is this sprint valuable?</h2>
        <Field label={`Sprint Goal for ${sprint.name}`} hint="One sentence the whole team commits to. It guides every decision during the sprint.">
          {(id, h) => (
            <textarea
              id={id}
              aria-describedby={h}
              className="input goal-input"
              rows={3}
              maxLength={LIMITS.shortText}
              defaultValue={sprint.goal}
              key={sprint.goal}
              disabled={ended}
              onBlur={(e) => e.target.value !== sprint.goal && run(() => api('PATCH', `/api/teams/${teamId}/sprints/${sprint.id}`, { goal: e.target.value.trim() }))}
            />
          )}
        </Field>
        <div className="row wrap">
          <Field label="Start">
            {(id) => <input id={id} type="date" className="input" value={sprint.startDate ?? ''} onChange={(e) => run(() => api('PATCH', `/api/teams/${teamId}/sprints/${sprint.id}`, { startDate: e.target.value || null }))} />}
          </Field>
          <Field label="End">
            {(id) => <input id={id} type="date" className="input" value={sprint.endDate ?? ''} onChange={(e) => run(() => api('PATCH', `/api/teams/${teamId}/sprints/${sprint.id}`, { endDate: e.target.value || null }))} />}
          </Field>
        </div>
      </section>
      <section className="card" aria-labelledby="goal-tips-h">
        <h2 id="goal-tips-h">What makes a good Sprint Goal?</h2>
        <ul className="tips">
          <li>
            <Icon name="check" /> “Enable students to create and manage their course profiles.” Focused, valuable, easy to explain to the client.
          </li>
          <li>
            <Icon name="close" /> “Complete 10 stories.” A list, not a goal.
          </li>
          <li>
            <Icon name="close" /> “Work on the profile system.” Too vague to guide decisions.
          </li>
        </ul>
        <p className="small muted">Think about how you will present this to your client or stakeholders in the Sprint Review.</p>
      </section>
    </div>
  );
}

function What() {
  const { view, send, ended } = useRoom();
  const { snap, teamId, name } = useTeam();
  const run = useAction();
  const { sprint, stories } = useSprint();
  const data = view.data as PlanningView;
  const [editing, setEditing] = useState<StoryDTO | 'new' | null>(null);
  const gate = useReadyGate();
  const rows: CapacityRow[] = snap.team.members.map(
    (m) => data.capacity.find((r) => r.userId === m.userId) ?? { userId: m.userId, daysAvailable: Math.round((snap.team.settings.sprintLengthDays * 5) / 7), hoursPerDay: 6, focusPercent: 100 },
  );
  const hours = capacityHours(rows);
  const velocity = averageVelocity(snap.sprints, snap.stories);
  const selected = points(stories);
  const backlog = snap.stories.filter((s) => !s.sprintId && s.status !== 'done').sort((a, b) => a.position - b.position);
  const hasDor = dorItems(snap.charter).length > 0;
  const firstSprint = velocity === null;
  const setRow = (r: CapacityRow) => send({ type: 'setCapacity', row: r });
  const add = (s: StoryDTO) => gate.addToSprint([s], sprint);
  const remove = (s: StoryDTO) => run(() => api('PATCH', `/api/teams/${teamId}/stories/${s.id}`, { sprintId: null, status: 'backlog' }));

  return (
    <div className="stack">
      <section className="card" aria-labelledby="cap-h">
        <h2 id="cap-h">Capacity</h2>
        <div className="table-scroll">
          <table className="table capacity">
            <thead>
              <tr>
                <th scope="col">Developer</th>
                <th scope="col">Days available</th>
                <th scope="col">Hours a day</th>
                <th scope="col">Focus %</th>
                <th scope="col">Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <th scope="row">{name(r.userId)}</th>
                  {(['daysAvailable', 'hoursPerDay', 'focusPercent'] as const).map((k) => (
                    <td key={k}>
                      <input
                        className="input input-short"
                        type="number"
                        min={0}
                        max={k === 'focusPercent' ? 100 : k === 'hoursPerDay' ? 24 : 60}
                        step={k === 'focusPercent' ? 5 : 0.5}
                        aria-label={`${name(r.userId)}: ${k === 'daysAvailable' ? 'days available' : k === 'hoursPerDay' ? 'hours a day' : 'focus percent'}`}
                        defaultValue={r[k]}
                        disabled={ended}
                        key={`${r.userId}-${k}-${r[k]}`}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isNaN(v) && v !== r[k]) void setRow({ ...r, [k]: v });
                        }}
                      />
                    </td>
                  ))}
                  <td>{Math.round(r.daysAvailable * r.hoursPerDay * r.focusPercent) / 100}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td colSpan={3} />
                <td>
                  <strong>{hours} h</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small muted">Lower the focus for people who are new to the team or have other commitments. Leave time for Scrum events, reviews and the unexpected.</p>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="sb-h">
          <div className="row between wrap">
            <h2 id="sb-h">Sprint Backlog</h2>
            <span>
              <strong>{selected}</strong> points{velocity !== null && <> · average velocity {velocity}</>}
            </span>
          </div>
          {velocity !== null && selected > velocity * 1.1 && <p className="callout warn small">You are planning more than your recent velocity. Is that realistic?</p>}
          {firstSprint && <p className="callout small">First sprint? Don’t over-commit: completing fewer stories well beats leaving many unfinished. Aim for about 70–80% of what feels possible.</p>}
          {stories.length === 0 ? (
            <p className="muted">Add stories from the Product Backlog.</p>
          ) : (
            <ul className="plain-list">
              {stories.map((s) => (
                <li key={s.id} className="row between">
                  <button type="button" className="link-btn" onClick={() => setEditing(s)}>
                    {s.title}
                  </button>
                  <span className="row">
                    {s.estimate ? <Badge tone="info">{s.estimate}</Badge> : <Badge tone="warn">No estimate</Badge>}
                    {!ended && (
                      <Button small variant="ghost" onClick={() => remove(s)} aria-label={`Remove ${s.title} from the sprint`}>
                        Remove
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="pb-h">
          <div className="row between wrap">
            <h2 id="pb-h">Product Backlog</h2>
            <span className="row">
              {!ended && (
                <Button small onClick={() => setEditing('new')}>
                  <Icon name="plus" size={14} /> New item
                </Button>
              )}
              <Link to={`/t/${teamId}/backlog`} className="small">
                Open backlog
              </Link>
            </span>
          </div>
          <p className="small muted">Refine items here until they meet your Definition of Ready, then add them to the sprint.</p>
          {backlog.length === 0 ? (
            <p className="muted">The Product Backlog is empty.</p>
          ) : (
            <ul className="plain-list">
              {backlog.map((s) => (
                <li key={s.id} className="row between">
                  <span>
                    <button type="button" className="link-btn" onClick={() => setEditing(s)}>
                      {s.title}
                    </button>
                    <span className="small muted block">
                      {s.estimate ? `${s.estimate} pts` : 'not estimated'} · INVEST {investScore(s)}/6
                      {hasDor && (isReady(s, snap.charter) ? ' · Ready' : ' · not Ready')}
                      {gate.problems(s).length > 0 && ` · ${gate.problems(s).length} thing${gate.problems(s).length === 1 ? '' : 's'} to fix before the sprint`}
                    </span>
                  </span>
                  {!ended && (
                    <Button small onClick={() => add(s)} aria-label={`Add ${s.title} to the sprint`}>
                      Add
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {editing && <StoryEditor story={editing === 'new' ? null : (snap.stories.find((s) => s.id === editing.id) ?? editing)} onClose={() => setEditing(null)} />}
      {gate.dialog}
    </div>
  );
}

function How() {
  const { stories } = useSprint();
  const { teamId, snap, name } = useTeam();
  const run = useAction();
  const { ended } = useRoom();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const addTask = (s: StoryDTO) => {
    const text = (drafts[s.id] ?? '').trim();
    if (!text) return;
    void run(() => api('PATCH', `/api/teams/${teamId}/stories/${s.id}`, { tasks: [...s.tasks, { id: Math.random().toString(36).slice(2, 10), text, done: false, ownerId: null }] }));
    setDrafts({ ...drafts, [s.id]: '' });
  };
  return (
    <div className="stack">
      <p className="muted">Break each story into tasks small enough to finish in a day or less. Owners are optional: the whole team owns the Sprint Backlog.</p>
      {stories.length === 0 && <Empty title="No stories in the sprint yet" />}
      <div className="grid-2">
        {stories.map((s) => (
          <section key={s.id} className="card" aria-label={s.title}>
            <h2 className="h3">{s.title}</h2>
            <ul className="plain-list">
              {s.tasks.map((t) => (
                <li key={t.id} className="row between">
                  <span>{t.text}</span>
                  <select
                    className="input input-small"
                    aria-label={`Owner of ${t.text}`}
                    value={t.ownerId ?? ''}
                    disabled={ended}
                    onChange={(e) => run(() => api('PATCH', `/api/teams/${teamId}/stories/${s.id}`, { tasks: s.tasks.map((x) => (x.id === t.id ? { ...x, ownerId: e.target.value || null } : x)) }))}
                  >
                    <option value="">No owner</option>
                    {snap.team.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {name(m.userId)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            {!ended && (
              <form
                className="inline-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  addTask(s);
                }}
              >
                <label className="sr-only" htmlFor={`task-${s.id}`}>
                  New task for {s.title}
                </label>
                <input id={`task-${s.id}`} className="input input-small" maxLength={LIMITS.shortText} value={drafts[s.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })} placeholder="Add a task" />
                <Button small type="submit">
                  Add
                </Button>
              </form>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function Commit() {
  const { view, send, isFacilitator, ended } = useRoom();
  const { snap, teamId } = useTeam();
  const run = useAction();
  const { sprint, stories } = useSprint();
  const data = view.data as PlanningView;
  const hours = capacityHours(data.capacity);
  const unestimated = stories.filter((s) => !s.estimate).length;
  const otherActive = snap.sprints.find((s) => s.status === 'active' && s.id !== sprint.id);
  return (
    <section className="card stack" aria-labelledby="commit-h">
      <h2 id="commit-h">Confirm the plan</h2>
      <dl className="summary-list">
        <dt>Sprint Goal</dt>
        <dd>{sprint.goal || <Badge tone="warn">Missing</Badge>}</dd>
        <dt>Stories</dt>
        <dd>
          {stories.length} stories, {points(stories)} points{unestimated > 0 && <> ({unestimated} not estimated)</>}
        </dd>
        <dt>Capacity</dt>
        <dd>{hours} focus hours</dd>
        <dt>Dates</dt>
        <dd>
          {sprint.startDate ?? '?'} to {sprint.endDate ?? '?'}
        </dd>
      </dl>
      {otherActive && <p className="callout warn">{otherActive.name} is still active. Close it in its Sprint Review before starting this one.</p>}
      {sprint.status === 'planned' && isFacilitator && !ended && (
        <div className="row wrap">
          <Button
            variant="primary"
            disabled={!!otherActive}
            onClick={async () => {
              const ok = await run(
                () => api('PATCH', `/api/teams/${teamId}/sprints/${sprint.id}`, { status: 'active', startDate: sprint.startDate ?? new Date().toISOString().slice(0, 10) }),
                `${sprint.name} has started`,
              );
              if (ok) await send({ type: 'end' });
            }}
          >
            Start {sprint.name} and end planning
          </Button>
        </div>
      )}
      {sprint.status === 'active' && <p>{sprint.name} is running. Good luck!</p>}
    </section>
  );
}
