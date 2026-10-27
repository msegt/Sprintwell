import { MEETING_INFO, averageVelocity, points, type MeetingKind } from '@sprintwell/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { KIND_ORDER, NewMeetingDialog } from '../components/NewMeeting';
import { Badge, Button, Empty, Icon, formatDate, relativeDays } from '../components/ui';
import { api } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';
import { BurndownChart } from './Sprint';

export function OverviewPage() {
  const { snap, teamId, name } = useTeam();
  const [kind, setKind] = useState<MeetingKind | null>(null);
  const run = useAction();
  usePageTitle(snap.team.name);

  const active = snap.sprints.find((s) => s.status === 'active');
  const sprintStories = active ? snap.stories.filter((s) => s.sprintId === active.id) : [];
  const total = points(sprintStories);
  const done = points(sprintStories.filter((s) => s.status === 'done'));
  const live = snap.meetings.filter((m) => !m.endedAt).slice(0, 6);
  const open = snap.actions.filter((a) => a.status === 'open');
  const velocity = averageVelocity(snap.sprints, snap.stories);

  return (
    <div className="page stack">
      <section className="card sprint-card" aria-labelledby="sprint-heading">
        {active ? (
          <>
            <div className="row between wrap">
              <div>
                <p className="eyebrow">Current sprint</p>
                <h1 id="sprint-heading">{active.name}</h1>
              </div>
              <div className="row wrap">
                {active.endDate && <Badge tone="info">{relativeDays(active.endDate)}</Badge>}
                <Link className="btn btn-secondary btn-small" to={`/t/${teamId}/sprint`}>
                  Sprint board
                </Link>
              </div>
            </div>
            <p className="sprint-goal">
              <strong>Sprint Goal:</strong> {active.goal || <span className="muted">Not set yet. Every sprint needs a goal: why is it valuable?</span>}
            </p>
            <div className="progress-row">
              <div className="progress" role="progressbar" aria-label="Story points done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
                <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
              </div>
              <span className="small">
                {done} of {total} points done · {sprintStories.filter((s) => s.status === 'done').length}/{sprintStories.length} stories
              </span>
            </div>
            {active.startDate && active.endDate && <BurndownChart sprint={active} stories={snap.stories} compact />}
            <p className="small muted">
              {formatDate(active.startDate)} to {formatDate(active.endDate)}
              {velocity !== null && ` · Average velocity ${velocity} points`}
            </p>
          </>
        ) : (
          <>
            <h1 id="sprint-heading">No sprint running</h1>
            <p className="muted">Start with Sprint Planning: agree a Sprint Goal, check capacity and pick the stories you can finish.</p>
            <Button variant="primary" onClick={() => setKind('planning')}>
              Plan a sprint
            </Button>
          </>
        )}
      </section>

      <section aria-labelledby="events-heading">
        <h2 id="events-heading">Start an event</h2>
        <ul className="event-grid">
          {KIND_ORDER.map((k) => (
            <li key={k}>
              <button type="button" className={`event-tile event-${k}`} onClick={() => setKind(k)}>
                <span className="event-name">{MEETING_INFO[k].name}</span>
                <span className="small">{MEETING_INFO[k].summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="live-heading">
          <h2 id="live-heading">Happening now</h2>
          {live.length === 0 ? (
            <Empty title="No events in progress" />
          ) : (
            <ul className="plain-list">
              {live.map((m) => (
                <li key={m.id} className="row between">
                  <span>
                    <strong>{m.title}</strong>
                    <span className="muted small"> · facilitated by {name(m.facilitatorId)}</span>
                  </span>
                  <Link className="btn btn-primary btn-small" to={`/t/${teamId}/m/${m.id}`}>
                    Join
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="actions-heading">
          <div className="row between">
            <h2 id="actions-heading">Open actions and impediments</h2>
            <Link to={`/t/${teamId}/actions`} className="small">
              All actions
            </Link>
          </div>
          {open.length === 0 ? (
            <Empty title="Nothing open">Actions from retrospectives and impediments from the Daily Scrum appear here.</Empty>
          ) : (
            <ul className="plain-list">
              {open.slice(0, 6).map((a) => (
                <li key={a.id} className="row between">
                  <span>
                    {a.kind === 'impediment' && <Badge tone="bad">Impediment</Badge>} {a.text}
                    <span className="muted small"> · {name(a.ownerId)}</span>
                  </span>
                  <Button small variant="ghost" onClick={() => run(() => api('PATCH', `/api/teams/${teamId}/actions/${a.id}`, { status: 'done' }))} aria-label={`Mark done: ${a.text}`}>
                    <Icon name="check" /> Done
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <NewMeetingDialog kind={kind} open={kind !== null} onClose={() => setKind(null)} />
    </div>
  );
}
