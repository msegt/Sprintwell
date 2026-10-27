import { MEETING_INFO, PHASES, type MeetingKind } from '@sprintwell/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { HowTo } from '../components/Guide';
import { KIND_ICON, KIND_ORDER, NewMeetingDialog } from '../components/NewMeeting';
import { PAGE_GUIDES } from '../content/guides';
import { Badge, Button, Empty, Icon, formatDate } from '../components/ui';
import { download } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';

export function MeetingsPage() {
  const { snap, teamId, name } = useTeam();
  const [kind, setKind] = useState<MeetingKind | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [filter, setFilter] = useState<MeetingKind | 'all'>('all');
  const run = useAction();
  usePageTitle('Events');

  const list = snap.meetings.filter((m) => filter === 'all' || m.kind === filter);
  const live = list.filter((m) => !m.endedAt);
  const past = list.filter((m) => m.endedAt);
  const phaseName = (k: MeetingKind, p: string) => PHASES[k].find((x) => x.id === p)?.name ?? p;

  return (
    <div className="page stack">
      <div className="row between wrap">
        <h1>Events</h1>
        <div className="row wrap">
          {KIND_ORDER.map((k) => (
            <Button
              key={k}
              small
              onClick={() => {
                setKind(k);
                setNewOpen(true);
              }}
            >
              <Icon name="plus" size={14} /> {MEETING_INFO[k].name}
            </Button>
          ))}
        </div>
      </div>
      <HowTo id="events" guide={PAGE_GUIDES.events} />
      <div className="segmented" role="group" aria-label="Filter events">
        {(['all', ...KIND_ORDER] as const).map((k) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {k === 'all' ? 'All' : MEETING_INFO[k].name}
          </button>
        ))}
      </div>

      <section aria-labelledby="live-h">
        <h2 id="live-h">In progress</h2>
        {live.length === 0 ? (
          <Empty title="Nothing in progress" />
        ) : (
          <ul className="meeting-list">
            {live.map((m) => (
              <li key={m.id} className={`meeting-row kind-${m.kind}`}>
                <span className="event-icon small-icon" aria-hidden="true">
                  <Icon name={KIND_ICON[m.kind]} size={16} />
                </span>
                <div className="meeting-row-main">
                  <Link to={`/t/${teamId}/m/${m.id}`} className="meeting-title">
                    {m.title}
                  </Link>
                  <p className="small muted">
                    {MEETING_INFO[m.kind].name} · {phaseName(m.kind, m.phase)} · facilitated by {name(m.facilitatorId)} · started {formatDate(m.createdAt)}
                  </p>
                </div>
                <Link className="btn btn-primary btn-small" to={`/t/${teamId}/m/${m.id}`}>
                  Join
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="past-h">
        <h2 id="past-h">Past events</h2>
        {past.length === 0 ? (
          <Empty title="No past events yet">Summaries of finished events stay here so you can look back, for example in your next retrospective.</Empty>
        ) : (
          <ul className="meeting-list">
            {past.map((m) => (
              <li key={m.id} className={`meeting-row kind-${m.kind}`}>
                <span className="event-icon small-icon" aria-hidden="true">
                  <Icon name={KIND_ICON[m.kind]} size={16} />
                </span>
                <div className="meeting-row-main">
                  <Link to={`/t/${teamId}/m/${m.id}`} className="meeting-title">
                    {m.title}
                  </Link>
                  <p className="small muted">
                    {MEETING_INFO[m.kind].name} · {formatDate(m.createdAt)} · facilitated by {name(m.facilitatorId)}
                  </p>
                </div>
                <div className="row">
                  <Badge>Ended</Badge>
                  <Button small variant="ghost" onClick={() => run(() => download(`/api/teams/${teamId}/meetings/${m.id}/summary.md`, 'summary.md'))} aria-label={`Download summary of ${m.title}`}>
                    <Icon name="download" /> Summary
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <NewMeetingDialog kind={kind} open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
