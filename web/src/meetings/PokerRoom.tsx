import { COFFEE, DECKS, LIMITS, UNSURE, points, shouldSplit, storySentence, type PokerItemView, type PokerView } from '@sprintwell/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, Badge, Button, Empty, Icon, Modal } from '../components/ui';
import { useNotice, useTeam } from '../lib/hooks';
import { useRoom } from './MeetingPage';

export function PokerRoom() {
  const { view, send, isFacilitator, ended } = useRoom();
  const data = view.data as PokerView;
  const current = data.items.find((i) => i.id === data.currentItemId) ?? null;
  const { announce } = useNotice();
  const wasRevealed = useRef(false);
  useEffect(() => {
    if (current?.revealed && !wasRevealed.current) announce('Votes revealed');
    wasRevealed.current = !!current?.revealed;
  }, [current?.revealed, announce]);

  if (view.phase === 'summary' || ended) return <PokerSummary data={data} />;

  return (
    <div className="poker-layout">
      <aside className="poker-items card" aria-labelledby="items-h">
        <h2 id="items-h">Stories ({data.items.filter((i) => i.finalEstimate).length}/{data.items.length} estimated)</h2>
        {data.items.length === 0 ? (
          <p className="muted small">{isFacilitator ? 'Add stories to estimate.' : 'Waiting for the facilitator to add stories.'}</p>
        ) : (
          <ol className="item-list">
            {data.items.map((i) => (
              <li key={i.id} className={i.id === data.currentItemId ? 'current' : ''}>
                {isFacilitator ? (
                  <button type="button" className="item-btn" aria-current={i.id === data.currentItemId ? 'true' : undefined} onClick={() => send({ type: 'selectItem', itemId: i.id })}>
                    <span className="item-title">{i.title}</span>
                    {i.finalEstimate ? <Badge tone="good">{i.finalEstimate}</Badge> : <span className="muted small">–</span>}
                  </button>
                ) : (
                  <div className="item-btn" aria-current={i.id === data.currentItemId ? 'true' : undefined}>
                    <span className="item-title">{i.title}</span>
                    {i.finalEstimate ? <Badge tone="good">{i.finalEstimate}</Badge> : <span className="muted small">–</span>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {isFacilitator && <AddItems data={data} />}
        {isFacilitator && (
          <div className="stack small-gap facil-settings">
            <label className="field">
              <span>Deck</span>
              <select className="input input-small" value={data.deckId} onChange={(e) => send({ type: 'setDeck', deckId: e.target.value })}>
                {DECKS.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                {data.deckId === 'custom' && <option value="custom">Custom</option>}
              </select>
            </label>
            <label className="check small">
              <input type="checkbox" checked={data.autoReveal} onChange={(e) => send({ type: 'setAutoReveal', autoReveal: e.target.checked })} />
              Reveal when everyone has voted
            </label>
          </div>
        )}
      </aside>

      <section className="poker-main" aria-labelledby="current-h">
        {current ? <CurrentItem item={current} data={data} /> : <Empty title="No story selected" />}
      </section>
    </div>
  );
}

function CurrentItem({ item, data }: { item: PokerItemView; data: PokerView }) {
  const { view, send, isFacilitator } = useRoom();
  const { snap, me, name } = useTeam();
  const story = item.storyId ? snap.stories.find((s) => s.id === item.storyId) : undefined;
  const observing = data.observers.includes(me.id);
  const present = snap.team.members.filter((m) => view.online.includes(m.userId) || item.voted.includes(m.userId));
  const voters = present.filter((m) => !data.observers.includes(m.userId));
  const [final, setFinal] = useState<string>('');
  useEffect(() => {
    setFinal(item.finalEstimate ?? item.stats?.suggestion ?? '');
  }, [item.id, item.revealed, item.stats?.suggestion, item.finalEstimate]);
  const stats = item.stats;
  const lowHigh = stats?.explainers && item.votes ? Object.entries(item.votes).filter(([, v]) => v === stats.explainers!.low || v === stats.explainers!.high) : [];

  return (
    <div className="stack">
      <div className="card current-story">
        <p className="eyebrow">
          Round {item.round}
          {item.finalEstimate && (
            <>
              {' '}
              · Final estimate <strong>{item.finalEstimate}</strong>
            </>
          )}
        </p>
        <h2 id="current-h">{item.title}</h2>
        {story && (
          <>
            {storySentence(story) && <p>{storySentence(story)}</p>}
            {story.acceptanceCriteria.length > 0 && (
              <details>
                <summary>Acceptance criteria ({story.acceptanceCriteria.length})</summary>
                <ul>
                  {story.acceptanceCriteria.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      <ul className="table-seats" aria-label="Votes">
        {voters.map((m) => {
          const voted = item.voted.includes(m.userId);
          const value = item.votes?.[m.userId];
          const outlier = !!stats?.explainers && (value === stats.explainers.low || value === stats.explainers.high);
          return (
            <li key={m.userId} className={`seat${voted ? ' voted' : ''}${outlier ? ' outlier' : ''}`}>
              <span className={`seat-card${item.revealed && value ? ' revealed' : ''}`} aria-hidden="true">
                {item.revealed ? (value ?? '–') : voted ? '' : ''}
              </span>
              <Avatar id={m.userId} name={m.displayName} size={28} online={view.online.includes(m.userId)} />
              <span className="seat-name">{m.displayName}</span>
              <span className="sr-only">{item.revealed ? (value ? `voted ${value}` : 'did not vote') : voted ? 'has voted' : 'has not voted yet'}</span>
            </li>
          );
        })}
      </ul>
      {data.observers.length > 0 && <p className="small muted">Observing: {data.observers.map((id) => name(id)).join(', ')}</p>}

      {item.revealed && stats && (
        <div className="card stats" aria-live="polite">
          {stats.consensus ? (
            <p className="consensus">
              <Icon name="check" /> Consensus on <strong>{stats.mode[0]}</strong>
            </p>
          ) : (
            stats.explainers && (
              <p>
                <strong>Discuss first:</strong> the lowest ({stats.explainers.low}) and highest ({stats.explainers.high}) estimates explain their thinking:{' '}
                {lowHigh.map(([u, v]) => `${name(u)} (${v})`).join(', ')}.
              </p>
            )
          )}
          <ul className="distribution" aria-label="Distribution of votes">
            {stats.distribution.map((d) => (
              <li key={d.card}>
                <span className="dist-card">{d.card}</span>
                <span className="dist-bar">
                  <span style={{ width: `${(d.count / Math.max(1, stats.voters)) * 100}%` }} />
                </span>
                <span className="dist-count">{d.count}</span>
              </li>
            ))}
          </ul>
          <p className="small muted">
            {stats.median !== null && `Median ${stats.median} · `}
            {stats.mean !== null && `Mean ${stats.mean} · `}
            {stats.unsure > 0 && `${stats.unsure} unsure · `}
            {stats.breakRequests > 0 && `${stats.breakRequests} want a break · `}
            {stats.voters} voted
          </p>
          {stats.breakRequests > 0 && stats.breakRequests * 2 >= stats.voters && <p className="callout small">Half the team asked for a break. Maybe take five minutes.</p>}
        </div>
      )}

      {item.history.length > 0 && (
        <details className="small">
          <summary>Earlier rounds</summary>
          <ul>
            {item.history.map((h) => (
              <li key={h.round}>
                Round {h.round}:{' '}
                {Object.entries(h.votes)
                  .map(([u, v]) => `${name(u)} ${v}`)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!item.revealed && (
        <div className="deck" role="group" aria-label="Your estimate">
          {data.deck.map((c) => (
            <button
              key={c}
              type="button"
              className={`poker-card${item.myVote === c ? ' selected' : ''}`}
              aria-pressed={item.myVote === c}
              disabled={observing}
              aria-label={c === UNSURE ? 'Not sure' : c === COFFEE ? 'I need a break' : `Estimate ${c}`}
              onClick={() => send({ type: 'vote', value: item.myVote === c ? null : c })}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="row wrap between">
        <label className="check small">
          <input type="checkbox" checked={observing} onChange={(e) => send({ type: 'setObserver', observer: e.target.checked })} />
          I’m observing (not voting)
        </label>
        {isFacilitator && (
          <div className="row wrap">
            {!item.revealed ? (
              <Button variant="primary" onClick={() => send({ type: 'reveal' })} disabled={item.voted.length === 0}>
                <Icon name="eye" /> Reveal ({item.voted.length}/{voters.length})
              </Button>
            ) : (
              <>
                <Button onClick={() => send({ type: 'revote' })}>Vote again</Button>
                <form
                  className="inline-form"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    if (final.trim()) void send({ type: 'finalise', value: final.trim() });
                  }}
                >
                  <label htmlFor="final-estimate" className="small">
                    Final estimate
                  </label>
                  <select id="final-estimate" className="input input-small" value={final} onChange={(e) => setFinal(e.target.value)}>
                    <option value="">Choose…</option>
                    {data.deck
                      .filter((c) => c !== UNSURE && c !== COFFEE)
                      .map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                  </select>
                  <Button type="submit" variant="primary" disabled={!final}>
                    Save estimate
                  </Button>
                </form>
              </>
            )}
          </div>
        )}
      </div>
      {item.finalEstimate && shouldSplit(item.finalEstimate, snap.team.settings.splitThreshold) && (
        <p className="callout warn small">This story is large. Consider splitting it before it enters a sprint.</p>
      )}
    </div>
  );
}

function AddItems({ data }: { data: PokerView }) {
  const { send } = useRoom();
  const { snap } = useTeam();
  const [title, setTitle] = useState('');
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const used = new Set(data.items.map((i) => i.storyId));
  const candidates = snap.stories.filter((s) => s.status !== 'done' && !used.has(s.id));
  return (
    <div className="stack small-gap">
      <form
        className="inline-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (title.trim() && (await send({ type: 'addItems', titles: [title.trim()] }))) setTitle('');
        }}
      >
        <label className="sr-only" htmlFor="poker-add">
          Story to estimate
        </label>
        <input id="poker-add" className="input input-small" maxLength={LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Type a story…" />
        <Button small type="submit">
          Add
        </Button>
      </form>
      <Button small onClick={() => setOpen(true)} disabled={candidates.length === 0}>
        From the backlog ({candidates.length})
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add stories from the backlog">
        <div className="check-list tall">
          {candidates.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))} />
              {s.title} {s.estimate && <span className="muted small">({s.estimate})</span>}
            </label>
          ))}
        </div>
        <div className="row end">
          <Button
            variant="primary"
            disabled={chosen.length === 0}
            onClick={async () => {
              if (await send({ type: 'addItems', storyIds: chosen })) {
                setChosen([]);
                setOpen(false);
              }
            }}
          >
            Add {chosen.length}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function PokerSummary({ data }: { data: PokerView }) {
  const { isFacilitator, send, ended } = useRoom();
  const estimated = data.items.filter((i) => i.finalEstimate);
  return (
    <div className="card stack">
      <h2>Summary</h2>
      <p>
        {estimated.length} of {data.items.length} stories estimated, {points(estimated.map((i) => ({ estimate: i.finalEstimate })))} points in total. Estimates for backlog stories have been saved to the
        stories.
      </p>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Story</th>
            <th scope="col">Estimate</th>
            <th scope="col">Rounds</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id}>
              <th scope="row">{i.title}</th>
              <td>{i.finalEstimate ?? <span className="muted">Not estimated</span>}</td>
              <td>{i.round}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isFacilitator && !ended && (
        <div className="row">
          <Button onClick={() => send({ type: 'setPhase', phase: 'estimate' })}>Back to estimating</Button>
          <Button variant="primary" onClick={() => send({ type: 'end' })}>
            End session
          </Button>
        </div>
      )}
    </div>
  );
}
