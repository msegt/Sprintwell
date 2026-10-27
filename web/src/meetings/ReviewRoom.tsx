import { LIMITS, points, storySentence, type ReviewView, type StoryDTO } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Badge, Button, ConfirmButton, Empty, Field, Icon } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useNotice, useTeam } from '../lib/hooks';
import { useRoom } from './MeetingPage';

export function ReviewRoom() {
  const { view } = useRoom();
  const { snap } = useTeam();
  const sprint = snap.sprints.find((s) => s.id === view.sprintId);
  if (!sprint) return <Empty title="This event is not linked to a sprint" />;
  if (view.phase === 'increment') return <Increment />;
  if (view.phase === 'feedback') return <Feedback />;
  return <Adapt />;
}

function useSprint() {
  const { view } = useRoom();
  const { snap } = useTeam();
  const sprint = snap.sprints.find((s) => s.id === view.sprintId)!;
  return { sprint, stories: snap.stories.filter((s) => s.sprintId === sprint.id) };
}

function Increment() {
  const { view, send, ended } = useRoom();
  const { teamId } = useTeam();
  const run = useAction();
  const { sprint, stories } = useSprint();
  const data = view.data as ReviewView;
  const done = stories.filter((s) => s.status === 'done');
  const notDone = stories.filter((s) => s.status !== 'done');
  const storyRow = (s: StoryDTO) => (
    <li key={s.id} className="review-story">
      <label className="check">
        <input type="checkbox" disabled={ended} checked={data.demoed.includes(s.id)} onChange={(e) => send({ type: 'setDemoed', storyId: s.id, demoed: e.target.checked })} />
        <span>
          <strong>{s.title}</strong> {s.estimate && <Badge tone="info">{s.estimate}</Badge>}
          {storySentence(s) && <span className="block small muted">{storySentence(s)}</span>}
        </span>
      </label>
    </li>
  );
  return (
    <div className="stack">
      <section className="card" aria-labelledby="goal-h">
        <p className="eyebrow">{sprint.name}</p>
        <h2 id="goal-h">Sprint Goal</h2>
        <p className="lead">{sprint.goal || <span className="muted">No Sprint Goal was set.</span>}</p>
        <fieldset className="segmented" disabled={ended}>
          <legend>Did we meet it?</legend>
          {(['yes', 'partly', 'no'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={sprint.goalMet === v} onClick={() => run(() => api('PATCH', `/api/teams/${teamId}/sprints/${sprint.id}`, { goalMet: v }))}>
              {v === 'yes' ? 'Yes' : v === 'partly' ? 'Partly' : 'No'}
            </button>
          ))}
        </fieldset>
      </section>
      <div className="grid-2">
        <section className="card" aria-labelledby="done-h">
          <h2 id="done-h">
            Done ({done.length} stories, {points(done)} points)
          </h2>
          <p className="small muted">Tick each story as you demonstrate it. Only work that meets the Definition of Done is part of the increment.</p>
          {done.length ? <ul className="plain-list">{done.map(storyRow)}</ul> : <p className="muted">Nothing is done yet.</p>}
        </section>
        <section className="card" aria-labelledby="notdone-h">
          <h2 id="notdone-h">Not done ({notDone.length})</h2>
          <p className="small muted">Be open about what didn’t get finished and why. These return to the Product Backlog when the sprint closes.</p>
          {notDone.length ? (
            <ul className="plain-list">
              {notDone.map((s) => (
                <li key={s.id}>
                  {s.title} <Badge>{s.status === 'doing' ? 'in progress' : 'to do'}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Everything planned is done.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Feedback() {
  const { view, send, ended } = useRoom();
  const { teamId } = useTeam();
  const { notify } = useNotice();
  const { stories } = useSprint();
  const data = view.data as ReviewView;
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [storyId, setStoryId] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await send({ type: 'addFeedback', text: text.trim(), from: from.trim(), storyId: storyId || null })) setText('');
  };
  const toBacklog = async (id: string, feedback: string) => {
    try {
      const story = await api<StoryDTO>('POST', `/api/teams/${teamId}/stories`, { title: feedback.slice(0, LIMITS.title), notes: `From Sprint Review feedback: ${feedback}` });
      await send({ type: 'markFeedbackAdded', feedbackId: id, storyId: story.id });
      notify('Added to the Product Backlog', 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className="grid-2">
      {!ended && (
        <form className="card stack" onSubmit={submit} aria-labelledby="fb-h">
          <h2 id="fb-h">Capture feedback</h2>
          <Field label="Feedback">{(id) => <textarea id={id} className="input" rows={3} maxLength={LIMITS.shortText} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
          <div className="row wrap">
            <Field label="From (optional)">{(id) => <input id={id} className="input" maxLength={LIMITS.displayName} value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.g. Client" />}</Field>
            <Field label="About (optional)">
              {(id) => (
                <select id={id} className="input" value={storyId} onChange={(e) => setStoryId(e.target.value)}>
                  <option value="">The product in general</option>
                  {stories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div>
            <Button type="submit" variant="primary">
              Add feedback
            </Button>
          </div>
        </form>
      )}
      <section className="card" aria-labelledby="fblist-h">
        <h2 id="fblist-h">Feedback ({data.feedback.length})</h2>
        {data.feedback.length === 0 ? (
          <p className="muted">Ask stakeholders what they think, what they would change and what matters most next.</p>
        ) : (
          <ul className="plain-list">
            {data.feedback.map((f) => (
              <li key={f.id} className="feedback-item">
                <p>{f.text}</p>
                <div className="row between wrap small">
                  <span className="muted">
                    {f.from || 'Anonymous'}
                    {f.storyId && ` · about ${stories.find((s) => s.id === f.storyId)?.title ?? 'a story'}`}
                  </span>
                  {f.backlogStoryId ? (
                    <Badge tone="good">In the backlog</Badge>
                  ) : (
                    !ended && (
                      <span className="row">
                        <Button small onClick={() => toBacklog(f.id, f.text)}>
                          <Icon name="plus" size={14} /> To backlog
                        </Button>
                        <button type="button" className="icon-btn" aria-label="Remove feedback" onClick={() => send({ type: 'removeFeedback', feedbackId: f.id })}>
                          <Icon name="trash" size={14} />
                        </button>
                      </span>
                    )
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Adapt() {
  const { view, send, isFacilitator, ended } = useRoom();
  const { snap, teamId } = useTeam();
  const run = useAction();
  const { sprint, stories } = useSprint();
  const data = view.data as ReviewView;
  const [notes, setNotes] = useState(data.notes);
  const top = snap.stories.filter((s) => !s.sprintId && s.status !== 'done').sort((a, b) => a.position - b.position).slice(0, 8);
  const unfinished = stories.filter((s) => s.status !== 'done').length;
  return (
    <div className="grid-2">
      <section className="card stack" aria-labelledby="adapt-h">
        <h2 id="adapt-h">What next?</h2>
        <p className="muted">Discuss what to do next, given what you learned. This is valuable input for the next Sprint Planning.</p>
        <label className="field">
          <span>Notes</span>
          <textarea className="input" rows={5} maxLength={LIMITS.longText} value={notes} disabled={ended} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== data.notes && send({ type: 'setNotes', notes })} />
        </label>
        {sprint.status !== 'closed' && isFacilitator && !ended && (
          <ConfirmButton
            variant="primary"
            small={false}
            confirmLabel={unfinished ? `Close ${sprint.name}: ${unfinished} unfinished stories go back to the backlog` : `Close ${sprint.name}`}
            onConfirm={() => run(() => api('POST', `/api/teams/${teamId}/sprints/${sprint.id}/close`), `${sprint.name} closed`)}
          >
            Close {sprint.name}
          </ConfirmButton>
        )}
        {sprint.status === 'closed' && <p>{sprint.name} is closed. Next: the Sprint Retrospective.</p>}
      </section>
      <section className="card" aria-labelledby="top-h">
        <div className="row between">
          <h2 id="top-h">Top of the Product Backlog</h2>
          <Link to={`/t/${teamId}/backlog`} className="small">
            Reorder
          </Link>
        </div>
        {top.length ? (
          <ol>
            {top.map((s) => (
              <li key={s.id}>
                {s.title} {s.estimate && <span className="muted small">({s.estimate})</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">The backlog is empty.</p>
        )}
      </section>
    </div>
  );
}
