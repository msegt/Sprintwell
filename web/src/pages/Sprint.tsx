import { burndown, points, velocityHistory, type SprintDTO, type StoryDTO, type StoryStatus } from '@sprintwell/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { StoryEditor } from '../components/StoryEditor';
import { Badge, Button, ConfirmButton, Empty, Field, InlineEdit, formatDate, relativeDays } from '../components/ui';
import { api } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';

const COLUMNS: { status: StoryStatus; title: string }[] = [
  { status: 'todo', title: 'To do' },
  { status: 'doing', title: 'In progress' },
  { status: 'done', title: 'Done' },
];

export function SprintPage() {
  const { snap, teamId, name } = useTeam();
  const run = useAction();
  const preferred = snap.sprints.find((s) => s.status === 'active') ?? snap.sprints.find((s) => s.status === 'planned') ?? snap.sprints[0];
  const [sprintId, setSprintId] = useState(preferred?.id ?? '');
  const [editing, setEditing] = useState<StoryDTO | null>(null);
  usePageTitle('Sprint');
  useEffect(() => {
    if (!snap.sprints.some((s) => s.id === sprintId) && preferred) setSprintId(preferred.id);
  }, [snap.sprints, sprintId, preferred]);

  const sprint = snap.sprints.find((s) => s.id === sprintId);
  const history = velocityHistory(snap.sprints, snap.stories);

  if (!sprint) {
    return (
      <div className="page">
        <h1>Sprint</h1>
        <Empty title="No sprints yet">
          <p>
            Run <Link to={`/t/${teamId}`}>Sprint Planning</Link> from the overview, or create a sprint below.
          </p>
          <NewSprint />
        </Empty>
      </div>
    );
  }

  const stories = snap.stories.filter((s) => s.sprintId === sprint.id);
  const patchSprint = (patch: Partial<SprintDTO>) => run(() => api('PATCH', `/api/teams/${teamId}/sprints/${sprint.id}`, patch));
  const move = (s: StoryDTO, status: StoryStatus) => run(() => api('PATCH', `/api/teams/${teamId}/stories/${s.id}`, { status }));

  return (
    <div className="page stack">
      <div className="row between wrap">
        <h1>
          <InlineEdit label="Sprint name" value={sprint.name} onSave={(v) => patchSprint({ name: v })} />
        </h1>
        <div className="row wrap">
          <label className="sr-only" htmlFor="sprint-select">
            Choose sprint
          </label>
          <select id="sprint-select" className="input" value={sprint.id} onChange={(e) => setSprintId(e.target.value)}>
            {snap.sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.status})
              </option>
            ))}
          </select>
          <NewSprint compact onCreated={setSprintId} />
        </div>
      </div>

      <section className="card stack">
        <div className="row wrap">
          <Badge tone={sprint.status === 'active' ? 'good' : sprint.status === 'closed' ? 'neutral' : 'info'}>{sprint.status}</Badge>
          {sprint.status === 'active' && sprint.endDate && <span className="small">{relativeDays(sprint.endDate)}</span>}
          {sprint.goalMet && <Badge tone={sprint.goalMet === 'yes' ? 'good' : sprint.goalMet === 'partly' ? 'warn' : 'bad'}>Goal met: {sprint.goalMet}</Badge>}
        </div>
        <Field label="Sprint Goal" hint="One sentence: why is this sprint valuable?">
          {(id, d) => (
            <textarea
              id={id}
              aria-describedby={d}
              className="input"
              rows={2}
              maxLength={500}
              defaultValue={sprint.goal}
              key={sprint.id + sprint.goal}
              onBlur={(e) => e.target.value !== sprint.goal && patchSprint({ goal: e.target.value })}
            />
          )}
        </Field>
        <div className="row wrap">
          <Field label="Start">
            {(id) => <input id={id} type="date" className="input" value={sprint.startDate ?? ''} onChange={(e) => patchSprint({ startDate: e.target.value || null })} />}
          </Field>
          <Field label="End">
            {(id) => <input id={id} type="date" className="input" value={sprint.endDate ?? ''} onChange={(e) => patchSprint({ endDate: e.target.value || null })} />}
          </Field>
        </div>
        <div className="row wrap">
          {sprint.status === 'planned' && (
            <Button variant="primary" onClick={() => patchSprint({ status: 'active', startDate: sprint.startDate ?? new Date().toISOString().slice(0, 10) })}>
              Start sprint
            </Button>
          )}
          {sprint.status === 'active' && (
            <ConfirmButton variant="primary" confirmLabel="Close sprint: unfinished stories go back to the backlog" onConfirm={() => run(() => api(`POST`, `/api/teams/${teamId}/sprints/${sprint.id}/close`), 'Sprint closed')}>
              Close sprint
            </ConfirmButton>
          )}
          {sprint.status === 'closed' && (
            <Button small onClick={() => patchSprint({ status: 'active' })}>
              Reopen
            </Button>
          )}
          <ConfirmButton confirmLabel="Delete sprint (stories are kept)" onConfirm={() => run(() => api('DELETE', `/api/teams/${teamId}/sprints/${sprint.id}`))}>
            Delete sprint
          </ConfirmButton>
        </div>
      </section>

      <section aria-labelledby="board-heading">
        <div className="row between">
          <h2 id="board-heading">Sprint Backlog</h2>
          <span className="small muted">
            {points(stories.filter((s) => s.status === 'done'))} / {points(stories)} points done
          </span>
        </div>
        {stories.length === 0 ? (
          <Empty title="No stories in this sprint">
            Add stories from the <Link to={`/t/${teamId}/backlog`}>Product Backlog</Link>.
          </Empty>
        ) : (
          <div className="board">
            {COLUMNS.map((col) => {
              const items = stories.filter((s) => (col.status === 'todo' ? s.status === 'todo' || s.status === 'backlog' : s.status === col.status));
              return (
                <section key={col.status} className="board-col" aria-label={`${col.title}, ${items.length} stories`}>
                  <h3>
                    {col.title} <span className="muted small">{items.length}</span>
                  </h3>
                  <ul className="plain-list">
                    {items.map((s) => (
                      <li key={s.id} className="story-card">
                        <button type="button" className="link-btn story-title" onClick={() => setEditing(s)}>
                          {s.title}
                        </button>
                        <div className="row between wrap small">
                          <span className="muted">
                            {s.estimate ? `${s.estimate} pts` : 'No estimate'} · {name(s.ownerId)}
                          </span>
                          {s.tasks.length > 0 && (
                            <span className="muted">
                              {s.tasks.filter((t) => t.done).length}/{s.tasks.length} tasks
                            </span>
                          )}
                        </div>
                        <label className="sr-only" htmlFor={`status-${s.id}`}>
                          Status of {s.title}
                        </label>
                        <select id={`status-${s.id}`} className="input input-small" value={s.status === 'backlog' ? 'todo' : s.status} onChange={(e) => move(s, e.target.value as StoryStatus)}>
                          {COLUMNS.map((c) => (
                            <option key={c.status} value={c.status}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="burndown-heading">
          <h2 id="burndown-heading">Burndown</h2>
          {sprint.startDate && sprint.endDate ? <BurndownChart sprint={sprint} stories={snap.stories} /> : <p className="muted">Set start and end dates to see the burndown.</p>}
        </section>
        <section className="card" aria-labelledby="velocity-heading">
          <h2 id="velocity-heading">Velocity</h2>
          {history.length === 0 ? (
            <p className="muted">Velocity appears once you close your first sprint.</p>
          ) : (
            <VelocityBars history={history.slice(0, 8).reverse()} />
          )}
        </section>
      </div>
      {editing && <StoryEditor story={snap.stories.find((s) => s.id === editing.id) ?? editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function NewSprint({ compact, onCreated }: { compact?: boolean; onCreated?: (id: string) => void }) {
  const { teamId, snap } = useTeam();
  const run = useAction();
  const create = async () => {
    const start = new Date();
    const end = new Date(start.getTime() + (snap.team.settings.sprintLengthDays - 1) * 86_400_000);
    const s = await run(() =>
      api<SprintDTO>('POST', `/api/teams/${teamId}/sprints`, {
        name: `Sprint ${snap.sprints.length + 1}`,
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
      }),
    );
    if (s) onCreated?.(s.id);
  };
  return (
    <Button small={compact} onClick={create}>
      New sprint
    </Button>
  );
}

export function BurndownChart({ sprint, stories, compact }: { sprint: SprintDTO; stories: StoryDTO[]; compact?: boolean }) {
  const data = burndown(sprint, stories);
  if (data.length < 2) return null;
  if ((data[0]?.ideal ?? 0) === 0) return compact ? null : <p className="muted">Estimate the stories in this sprint to see the burndown.</p>;
  const W = 600;
  const H = compact ? 120 : 220;
  const pad = { l: 34, r: 10, t: 10, b: 24 };
  const max = Math.max(1, ...data.map((d) => d.ideal), ...data.map((d) => d.remaining ?? 0));
  const x = (i: number) => pad.l + (i / (data.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ideal = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.ideal)}`).join('');
  const actualPts = data.filter((d) => d.remaining !== null);
  const actual = actualPts.map((d, i) => `${i ? 'L' : 'M'}${x(data.indexOf(d))},${y(d.remaining!)}`).join('');
  const last = actualPts[actualPts.length - 1];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Burndown: ${last ? `${last.remaining} of ${data[0]!.ideal} points remaining on ${formatDate(last.date)}` : 'sprint not started'}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="grid-line" />
            <text x={pad.l - 6} y={y(max * f) + 4} textAnchor="end" className="axis-label">
              {Number((max * f).toFixed(max * f < 10 && max % 2 === 1 ? 1 : 0))}
            </text>
          </g>
        ))}
        <path d={ideal} className="line-ideal" />
        {actual && <path d={actual} className="line-actual" />}
        {actualPts.map((d) => (
          <circle key={d.date} cx={x(data.indexOf(d))} cy={y(d.remaining!)} r={3} className="dot-actual" />
        ))}
        {!compact &&
          [0, data.length - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i ? 'end' : 'start'} className="axis-label">
              {formatDate(data[i]!.date)}
            </text>
          ))}
      </svg>
      {!compact && (
        <figcaption className="legend small">
          <span className="legend-ideal">Ideal</span> <span className="legend-actual">Remaining points</span>
        </figcaption>
      )}
    </figure>
  );
}

function VelocityBars({ history }: { history: { sprint: SprintDTO; points: number }[] }) {
  const max = Math.max(1, ...history.map((h) => h.points));
  return (
    <ul className="bars" aria-label="Points completed per sprint">
      {history.map((h) => (
        <li key={h.sprint.id}>
          <span className="bar-label">{h.sprint.name}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(h.points / max) * 100}%` }} />
          </span>
          <span className="bar-value">{h.points}</span>
        </li>
      ))}
    </ul>
  );
}
