import { LIMITS, type DailyView } from '@sprintwell/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Avatar, Badge, Button, Icon } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useTeam } from '../lib/hooks';
import { useRoom } from './MeetingPage';

export function DailyRoom() {
  const { view, send, isFacilitator, ended } = useRoom();
  const { snap, name, me, teamId } = useTeam();
  const run = useAction();
  const data = view.data as DailyView;
  const sprint = snap.sprints.find((s) => s.id === view.sprintId) ?? snap.sprints.find((s) => s.status === 'active');
  const order = [...data.order, ...snap.team.members.map((m) => m.userId).filter((id) => !data.order.includes(id))];
  const speaker = order[data.current];
  const finished = data.current >= order.length;
  const sprintStories = sprint ? snap.stories.filter((s) => s.sprintId === sprint.id) : [];

  return (
    <div className="daily-layout">
      <div className="stack">
        <section className="card sprint-goal-card">
          <p className="eyebrow">Sprint Goal{sprint ? `: ${sprint.name}` : ''}</p>
          <p className="lead">{sprint?.goal || <span className="muted">No Sprint Goal set. The Daily Scrum is about progress towards it.</span>}</p>
          {sprintStories.length > 0 && (
            <p className="small muted">
              {sprintStories.filter((s) => s.status === 'done').length} done · {sprintStories.filter((s) => s.status === 'doing').length} in progress · {sprintStories.filter((s) => s.status === 'todo' || s.status === 'backlog').length} to do
            </p>
          )}
        </section>

        {view.phase === 'updates' && !ended && (
          <section className="card stack" aria-labelledby="speaker-h" aria-live="polite">
            {finished ? (
              <>
                <h2 id="speaker-h">Everyone has spoken</h2>
                <p className="muted">Move longer conversations to “After the Daily Scrum”, so only the people who need them stay.</p>
                {isFacilitator && (
                  <Button variant="primary" onClick={() => send({ type: 'setPhase', phase: 'parking' })}>
                    After the Daily Scrum
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="eyebrow">
                  Speaking now ({data.current + 1} of {order.length})
                </p>
                <h2 id="speaker-h" className="row">
                  {speaker && <Avatar id={speaker} name={name(speaker)} size={40} />} {name(speaker)}
                </h2>
                {speaker && <UpdateDisplay update={data.updates[speaker]} />}
                {speaker && data.updates[speaker]?.blockers && (
                  <div>
                  <Button
                    small
                    onClick={() =>
                      run(() => api('POST', `/api/teams/${teamId}/actions`, { kind: 'impediment', text: data.updates[speaker]!.blockers, ownerId: speaker, meetingId: view.id }), 'Impediment recorded')
                    }
                  >
                    <Icon name="flag" /> Record as impediment
                  </Button>
                  </div>
                )}
                {isFacilitator && (
                  <div className="row wrap">
                    <Button onClick={() => send({ type: 'prev' })} disabled={data.current === 0}>
                      Previous
                    </Button>
                    <Button variant="primary" onClick={() => send({ type: 'next' })}>
                      Next person <Icon name="arrow" size={14} />
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {(view.phase === 'parking' || ended) && <Parking data={data} />}
        {view.phase === 'updates' && !ended && <MyUpdate data={data} />}
        {ended && <AllUpdates data={data} order={order} />}
      </div>

      <aside className="card" aria-labelledby="order-h">
        <div className="row between">
          <h2 id="order-h">Order</h2>
          {isFacilitator && !ended && (
            <Button small variant="ghost" onClick={() => send({ type: 'shuffle' })}>
              <Icon name="shuffle" size={14} /> Shuffle
            </Button>
          )}
        </div>
        <ol className="speaker-list">
          {order.map((id, i) => (
            <li key={id} className={i === data.current ? 'current' : data.done.includes(id) ? 'done' : ''}>
              {isFacilitator && !ended ? (
                <button type="button" className="item-btn" onClick={() => send({ type: 'setSpeaker', index: i })} aria-current={i === data.current ? 'true' : undefined}>
                  <Avatar id={id} name={name(id)} size={24} online={view.online.includes(id)} /> <span className="item-title">{name(id)}</span>
                  {data.updates[id] && <Badge tone="info">Ready</Badge>}
                </button>
              ) : (
                <div className="item-btn" aria-current={i === data.current ? 'true' : undefined}>
                  <Avatar id={id} name={name(id)} size={24} online={view.online.includes(id)} /> <span className="item-title">{name(id)}</span>
                  {data.updates[id] && <Badge tone="info">Ready</Badge>}
                </div>
              )}
            </li>
          ))}
        </ol>
        {isFacilitator && !ended && (
          <label className="field">
            <span>Seconds per person</span>
            <input
              className="input input-short"
              type="number"
              min={15}
              max={600}
              step={15}
              defaultValue={data.perPersonSeconds}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (n >= 15 && n !== data.perPersonSeconds) void send({ type: 'setPerPerson', seconds: n });
              }}
            />
          </label>
        )}
        <p className="small muted">The timer restarts for each person. The whole Daily Scrum is timeboxed to 15 minutes.</p>
        {me && !data.updates[me.id] && view.phase === 'updates' && !ended && <p className="small">Tip: fill in your update before your turn.</p>}
      </aside>
    </div>
  );
}

function UpdateDisplay({ update }: { update?: { yesterday: string; today: string; blockers: string } }) {
  if (!update) return <p className="muted">No written update. They will speak to it.</p>;
  return (
    <dl className="update">
      <dt>Yesterday, towards the Sprint Goal</dt>
      <dd>{update.yesterday || '–'}</dd>
      <dt>Today, towards the Sprint Goal</dt>
      <dd>{update.today || '–'}</dd>
      <dt>Blockers</dt>
      <dd>{update.blockers || 'None'}</dd>
    </dl>
  );
}

function MyUpdate({ data }: { data: DailyView }) {
  const { send } = useRoom();
  const { me } = useTeam();
  const mine = data.updates[me.id];
  const [y, setY] = useState(mine?.yesterday ?? '');
  const [t, setT] = useState(mine?.today ?? '');
  const [b, setB] = useState(mine?.blockers ?? '');
  useEffect(() => {
    if (mine) {
      setY(mine.yesterday);
      setT(mine.today);
      setB(mine.blockers);
    }
    // Only when the saved update changes.
  }, [mine?.yesterday, mine?.today, mine?.blockers]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send({ type: 'setUpdate', yesterday: y.trim(), today: t.trim(), blockers: b.trim() });
  };
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="my-update-h">
      <h2 id="my-update-h">Your update</h2>
      <label className="field">
        <span>What did I do yesterday that helped the team meet the Sprint Goal?</span>
        <textarea className="input" rows={2} maxLength={LIMITS.shortText} value={y} onChange={(e) => setY(e.target.value)} />
      </label>
      <label className="field">
        <span>What will I do today to help the team meet the Sprint Goal?</span>
        <textarea className="input" rows={2} maxLength={LIMITS.shortText} value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <label className="field">
        <span>Do I see any impediment that stops me or the team?</span>
        <textarea className="input" rows={2} maxLength={LIMITS.shortText} value={b} onChange={(e) => setB(e.target.value)} />
      </label>
      <div>
        <Button type="submit" variant="primary">
          {mine ? 'Update' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

function Parking({ data }: { data: DailyView }) {
  const { send, ended } = useRoom();
  const { name, me } = useTeam();
  const [text, setText] = useState('');
  return (
    <section className="card stack" aria-labelledby="parking-h">
      <h2 id="parking-h">After the Daily Scrum</h2>
      <p className="small muted">Topics for the people who need them, after the 15 minutes. Not everyone has to stay.</p>
      <ul className="plain-list">
        {data.parking.map((p) => (
          <li key={p.id} className="row between">
            <span>
              {p.text} <span className="muted small">· {name(p.authorId)}</span>
            </span>
            {!ended && p.authorId === me.id && (
              <button type="button" className="icon-btn" aria-label={`Remove ${p.text}`} onClick={() => send({ type: 'removeParking', itemId: p.id })}>
                <Icon name="trash" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!ended && (
        <form
          className="inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (text.trim() && (await send({ type: 'addParking', text: text.trim() }))) setText('');
          }}
        >
          <label className="sr-only" htmlFor="parking-new">
            New topic
          </label>
          <input id="parking-new" className="input" maxLength={LIMITS.shortText} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Agree the API format with Sam" />
          <Button type="submit" small>
            Add
          </Button>
        </form>
      )}
    </section>
  );
}

function AllUpdates({ data, order }: { data: DailyView; order: string[] }) {
  const { name } = useTeam();
  return (
    <section className="card" aria-labelledby="all-h">
      <h2 id="all-h">Updates</h2>
      {order
        .filter((id) => data.updates[id])
        .map((id) => (
          <div key={id}>
            <h3>{name(id)}</h3>
            <UpdateDisplay update={data.updates[id]} />
          </div>
        ))}
    </section>
  );
}
