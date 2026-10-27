import { ESVP, KERTH_ATTRIBUTION, KERTH_PRIME_DIRECTIVE, LIMITS, type RetroCardView, type RetroColumn, type RetroView } from '@sprintwell/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Empty, Icon, InlineEdit } from '../components/ui';
import { download } from '../lib/api';
import { useAction, useTeam } from '../lib/hooks';
import { ActionList, NewAction } from '../pages/Actions';
import { useRoom } from './MeetingPage';

interface Topic {
  id: string;
  title: string;
  columnId: string;
  cards: RetroCardView[];
  isGroup: boolean;
}

function topicsOf(data: RetroView): Topic[] {
  const groups = data.groups.map((g) => ({ id: g.id, title: g.title, columnId: g.columnId, cards: data.cards.filter((c) => c.groupId === g.id), isGroup: true }));
  const singles = data.cards.filter((c) => !c.groupId).map((c) => ({ id: c.id, title: c.text, columnId: c.columnId, cards: [c], isGroup: false }));
  return [...groups, ...singles];
}

export function RetroRoom() {
  const { view, ended } = useRoom();
  const data = view.data as RetroView;
  if (ended) return <RetroClosed data={data} />;
  switch (view.phase) {
    case 'checkin':
      return <CheckIn data={data} />;
    case 'review':
      return <ReviewActions />;
    case 'reflect':
      return <Reflect data={data} />;
    case 'group':
      return <Group data={data} />;
    case 'vote':
      return <Vote data={data} />;
    case 'discuss':
      return <Discuss data={data} />;
    default:
      return <Close data={data} />;
  }
}

function PrimeDirective() {
  return (
    <blockquote className="prime-directive">
      <p>{KERTH_PRIME_DIRECTIVE}</p>
      <footer>{KERTH_ATTRIBUTION}</footer>
    </blockquote>
  );
}

function CheckIn({ data }: { data: RetroView }) {
  const { send, isFacilitator } = useRoom();
  const { me, name } = useTeam();
  const mine = data.checkins.find((c) => c.userId === me.id)?.word ?? '';
  const [word, setWord] = useState(mine);
  const [question, setQuestion] = useState(data.checkinQuestion);
  useEffect(() => setQuestion(data.checkinQuestion), [data.checkinQuestion]);
  const total = Object.values(data.esvp).reduce((a, b) => a + b, 0);
  return (
    <div className="stack">
      <PrimeDirective />
      <div className="grid-2">
        <section className="card" aria-labelledby="checkin-h">
          <h2 id="checkin-h">Check-in</h2>
          {isFacilitator ? (
            <InlineEdit label="Check-in question" value={question} onSave={(v) => send({ type: 'setCheckinQuestion', question: v })} />
          ) : (
            <p className="lead">{data.checkinQuestion}</p>
          )}
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send({ type: 'checkin', word: word.trim() });
            }}
          >
            <label className="sr-only" htmlFor="checkin-word">
              Your answer
            </label>
            <input id="checkin-word" className="input" maxLength={60} value={word} onChange={(e) => setWord(e.target.value)} placeholder="A word or short phrase" />
            <Button type="submit" variant="primary">
              Share
            </Button>
          </form>
          <ul className="checkin-list">
            {data.checkins.map((c) => (
              <li key={c.userId}>
                <strong>{name(c.userId)}</strong>: {c.word}
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="esvp-h">
          <h2 id="esvp-h">Safety check (anonymous)</h2>
          <p className="small muted">How do you feel about being here? Only the totals are shown, never who chose what.</p>
          <div className="esvp" role="radiogroup" aria-label="Explorer, Shopper, Vacationer or Prisoner">
            {ESVP.map((e) => (
              <label key={e.id} className={`esvp-option${data.myEsvp === e.id ? ' selected' : ''}`}>
                <input type="radio" name="esvp" checked={data.myEsvp === e.id} onChange={() => send({ type: 'checkin', word: data.checkins.find((c) => c.userId === me.id)?.word ?? '', esvp: e.id })} />
                <span className="esvp-name">{e.name}</span>
                <span className="small muted">{e.hint}</span>
                <span className="esvp-count" aria-label={`${data.esvp[e.id]} people`}>
                  {data.esvp[e.id]}
                </span>
              </label>
            ))}
          </div>
          {total > 0 && data.esvp.prisoner * 3 >= total && <p className="callout small">Several people feel like prisoners. It may help to talk about why before going further.</p>}
        </section>
      </div>
    </div>
  );
}

function ReviewActions() {
  const { snap, teamId } = useTeam();
  const open = snap.actions.filter((a) => a.status === 'open');
  const recent = snap.actions.filter((a) => a.status === 'done' && a.completedAt && Date.now() - Date.parse(a.completedAt) < 45 * 86_400_000);
  return (
    <section className="card stack" aria-labelledby="prev-h">
      <h2 id="prev-h">Did we do what we said we would?</h2>
      <p className="muted">Start by checking the actions from previous retrospectives. Tick the ones that are done; talk briefly about the rest.</p>
      {open.length === 0 ? <Empty title="No open actions" /> : <ActionList actions={open} teamId={teamId} compact />}
      {recent.length > 0 && (
        <details>
          <summary>Recently completed ({recent.length})</summary>
          <ActionList actions={recent} teamId={teamId} compact />
        </details>
      )}
    </section>
  );
}

function columnClass(c: RetroColumn) {
  return `retro-col tone-${c.tone}`;
}

function Reflect({ data }: { data: RetroView }) {
  return (
    <div className="stack">
      <p className="muted">Write silently and on your own. Others can’t see your cards until the facilitator moves on to grouping.</p>
      <div className="retro-board" style={{ ['--cols' as string]: data.columns.length }}>
        {data.columns.map((col) => (
          <section key={col.id} className={columnClass(col)} aria-labelledby={`col-${col.id}`}>
            <h2 id={`col-${col.id}`}>{col.title}</h2>
            <p className="small muted">{col.prompt}</p>
            <AddCard column={col} />
            <ul className="retro-cards">
              {data.cards
                .filter((c) => c.columnId === col.id)
                .map((c) => (
                  <MyCard key={c.id} card={c} />
                ))}
            </ul>
            {(data.hiddenCounts[col.id] ?? 0) > 0 && (
              <p className="small muted hidden-count">
                + {data.hiddenCounts[col.id]} card{data.hiddenCounts[col.id] === 1 ? '' : 's'} from others (hidden)
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function AddCard({ column }: { column: RetroColumn }) {
  const { send } = useRoom();
  const [text, setText] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim()) return;
    if (await send({ type: 'addCard', columnId: column.id, text: text.trim() })) setText('');
  };
  return (
    <form onSubmit={submit} className="add-card">
      <label className="sr-only" htmlFor={`add-${column.id}`}>
        Add a card to {column.title}
      </label>
      <textarea
        id={`add-${column.id}`}
        className="input"
        rows={2}
        maxLength={LIMITS.cardText}
        value={text}
        placeholder="Type, then press Enter"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <Button small type="submit" disabled={!text.trim()}>
        Add card
      </Button>
    </form>
  );
}

function MyCard({ card }: { card: RetroCardView }) {
  const { send } = useRoom();
  return (
    <li className="retro-card mine">
      <InlineEdit label="Your card" value={card.text} multiline maxLength={LIMITS.cardText} onSave={(v) => send({ type: 'editCard', cardId: card.id, text: v })} />
      <button type="button" className="icon-btn" aria-label={`Delete card: ${card.text}`} onClick={() => send({ type: 'deleteCard', cardId: card.id })}>
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}

function CardText({ card }: { card: RetroCardView }) {
  const { name } = useTeam();
  return (
    <span>
      {card.text}
      {card.authorId && <span className="muted small"> · {name(card.authorId)}</span>}
    </span>
  );
}

function Group({ data }: { data: RetroView }) {
  const { send, isFacilitator } = useRoom();
  const topics = topicsOf(data);
  const short = (t: string) => (t.length > 50 ? `${t.slice(0, 50)}…` : t);
  return (
    <div className="stack">
      <p className="muted">Read everyone’s cards, then group similar ones together. Anyone can group. You can still add cards.</p>
      <div className="retro-board" style={{ ['--cols' as string]: data.columns.length }}>
        {data.columns.map((col) => (
          <section key={col.id} className={columnClass(col)} aria-labelledby={`col-${col.id}`}>
            <h2 id={`col-${col.id}`}>{col.title}</h2>
            <ul className="retro-cards">
              {topics
                .filter((t) => t.columnId === col.id)
                .map((t) => (
                  <li key={t.id} className={`retro-card${t.isGroup ? ' group' : ''}`}>
                    {t.isGroup ? (
                      <>
                        <div className="group-title">
                          <InlineEdit label="Group name" value={t.title} maxLength={LIMITS.title} onSave={(v) => send({ type: 'renameGroup', groupId: t.id, title: v })} />
                        </div>
                        <ul className="group-cards">
                          {t.cards.map((c) => (
                            <li key={c.id}>
                              <CardText card={c} />
                              <Button small variant="ghost" onClick={() => send({ type: 'ungroup', cardId: c.id })} aria-label={`Take “${short(c.text)}” out of the group`}>
                                Ungroup
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <CardText card={t.cards[0]!} />
                    )}
                    {!t.isGroup && (
                      <GroupWith
                        card={t.cards[0]!}
                        options={data.cards.filter((c) => c.id !== t.cards[0]!.id)}
                        onGroup={(into) => send({ type: 'group', cardId: t.cards[0]!.id, intoCardId: into })}
                        label={short(t.title)}
                      />
                    )}
                    {!t.isGroup && (t.cards[0]!.mine || isFacilitator) && (
                      <button type="button" className="icon-btn" aria-label={`Delete card: ${short(t.title)}`} onClick={() => send({ type: 'deleteCard', cardId: t.cards[0]!.id })}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </li>
                ))}
            </ul>
            <AddCard column={col} />
          </section>
        ))}
      </div>
    </div>
  );
}

function GroupWith({ card, options, onGroup, label }: { card: RetroCardView; options: RetroCardView[]; onGroup(id: string): void; label: string }) {
  if (options.length === 0) return null;
  return (
    <>
      <label className="sr-only" htmlFor={`gw-${card.id}`}>
        Group “{label}” with
      </label>
      <select
        id={`gw-${card.id}`}
        className="input input-small group-with"
        value=""
        onChange={(e) => {
          if (e.target.value) onGroup(e.target.value);
        }}
      >
        <option value="">Group with…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.text.length > 60 ? `${o.text.slice(0, 60)}…` : o.text}
          </option>
        ))}
      </select>
    </>
  );
}

function Vote({ data }: { data: RetroView }) {
  const { send } = useRoom();
  const topics = topicsOf(data);
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted">Spread your votes over the topics you most want to discuss. You can put more than one vote on a topic.</p>
        <p className="votes-left" aria-live="polite">
          <strong>{data.votesRemaining}</strong> of {data.votesPerPerson} votes left · {data.voterCount} {data.voterCount === 1 ? 'person has' : 'people have'} voted
        </p>
      </div>
      <div className="retro-board" style={{ ['--cols' as string]: data.columns.length }}>
        {data.columns.map((col) => (
          <section key={col.id} className={columnClass(col)} aria-labelledby={`col-${col.id}`}>
            <h2 id={`col-${col.id}`}>{col.title}</h2>
            <ul className="retro-cards">
              {topics
                .filter((t) => t.columnId === col.id)
                .map((t) => {
                  const mine = data.myVotes[t.id] ?? 0;
                  return (
                    <li key={t.id} className={`retro-card${t.isGroup ? ' group' : ''}${mine ? ' has-votes' : ''}`}>
                      <div>
                        <strong className="block">{t.title}</strong>
                        {t.isGroup && <span className="small muted">{t.cards.length} cards</span>}
                      </div>
                      <div className="vote-controls" role="group" aria-label={`Your votes for ${t.title}`}>
                        <button type="button" className="icon-btn" aria-label="Remove a vote" disabled={mine === 0} onClick={() => send({ type: 'vote', topicId: t.id, delta: -1 })}>
                          −
                        </button>
                        <span className="vote-dots" aria-label={`${mine} votes`}>
                          {'●'.repeat(mine) || '○'}
                        </span>
                        <button type="button" className="icon-btn" aria-label="Add a vote" disabled={data.votesRemaining === 0} onClick={() => send({ type: 'vote', topicId: t.id, delta: 1 })}>
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Discuss({ data }: { data: RetroView }) {
  const { send, isFacilitator, view } = useRoom();
  const { snap, teamId } = useTeam();
  const topics = topicsOf(data).sort((a, b) => (data.totals?.[b.id] ?? 0) - (data.totals?.[a.id] ?? 0));
  const current = topics.find((t) => t.id === data.currentTopicId) ?? null;
  const actions = snap.actions.filter((a) => a.meetingId === view.id);
  return (
    <div className="discuss-layout">
      <section className="card" aria-labelledby="topics-h">
        <h2 id="topics-h">Topics by votes</h2>
        <ol className="topic-list">
          {topics.map((t) => (
            <li key={t.id} className={t.id === data.currentTopicId ? 'current' : ''}>
              {isFacilitator ? (
                <button type="button" className="item-btn" aria-current={t.id === data.currentTopicId ? 'true' : undefined} onClick={() => send({ type: 'selectTopic', topicId: t.id })}>
                  <span className="item-title">{t.title}</span>
                  <span className="vote-total">{data.totals?.[t.id] ?? 0}</span>
                </button>
              ) : (
                <div className="item-btn" aria-current={t.id === data.currentTopicId ? 'true' : undefined}>
                  <span className="item-title">{t.title}</span>
                  <span className="vote-total">{data.totals?.[t.id] ?? 0}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
      <section className="stack" aria-labelledby="now-h">
        {current ? (
          <div className="card stack">
            <p className="eyebrow">Discussing now</p>
            <h2 id="now-h">{current.title}</h2>
            {current.isGroup && (
              <ul>
                {current.cards.map((c) => (
                  <li key={c.id}>
                    <CardText card={c} />
                  </li>
                ))}
              </ul>
            )}
            <TopicNotes topicId={current.id} value={data.notes[current.id] ?? ''} />
          </div>
        ) : (
          <div className="card">
            <h2 id="now-h">Pick a topic</h2>
            <p className="muted">{isFacilitator ? 'Choose the topic with the most votes to start.' : 'The facilitator will choose the first topic.'}</p>
          </div>
        )}
        <NewAction meetingId={view.id} label="Agree an action" />
        {actions.length > 0 && (
          <div className="card">
            <h3>Actions from this retrospective</h3>
            <ActionList actions={actions} teamId={teamId} compact />
          </div>
        )}
        <p className="small muted">Aim for one to three concrete actions with owners. Fewer, finished actions beat many forgotten ones.</p>
      </section>
    </div>
  );
}

function TopicNotes({ topicId, value }: { topicId: string; value: string }) {
  const { send } = useRoom();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value, topicId]);
  return (
    <div className="field">
      <label htmlFor={`notes-${topicId}`}>Notes</label>
      <textarea id={`notes-${topicId}`} className="input" rows={4} maxLength={LIMITS.longText} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && send({ type: 'note', topicId, text })} />
      <p className="hint">Saved when you leave the box.</p>
    </div>
  );
}

function Close({ data }: { data: RetroView }) {
  const { send, isFacilitator, view } = useRoom();
  const { snap, teamId } = useTeam();
  const actions = snap.actions.filter((a) => a.meetingId === view.id);
  const max = Math.max(1, ...data.roti.counts);
  return (
    <div className="grid-2">
      <section className="card" aria-labelledby="roti-h">
        <h2 id="roti-h">Return on time invested</h2>
        <p className="muted small">Was this retrospective worth your time? 1 = a waste of time, 5 = very worthwhile. Anonymous.</p>
        <div className="roti" role="radiogroup" aria-label="Rating from 1 to 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={data.roti.mine === n} className={`roti-btn${data.roti.mine === n ? ' selected' : ''}`} onClick={() => send({ type: 'roti', score: n })}>
              {n}
            </button>
          ))}
        </div>
        <ul className="roti-hist" aria-label={`${data.roti.responses} responses`}>
          {data.roti.counts.map((c, i) => (
            <li key={i}>
              <span>{i + 1}</span>
              <span className="dist-bar">
                <span style={{ width: `${(c / max) * 100}%` }} />
              </span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card stack" aria-labelledby="close-actions-h">
        <h2 id="close-actions-h">Our actions</h2>
        {actions.length === 0 ? <p className="muted">No actions agreed. Is there one small thing worth trying next sprint?</p> : <ActionList actions={actions} teamId={teamId} compact />}
        <p className="small muted">Remember to review your working agreement if anything here changes how you work.</p>
        {isFacilitator && (
          <Button variant="primary" onClick={() => send({ type: 'end' })}>
            End retrospective
          </Button>
        )}
      </section>
    </div>
  );
}

function RetroClosed({ data }: { data: RetroView }) {
  const { view } = useRoom();
  const { snap, teamId } = useTeam();
  const run = useAction();
  const topics = topicsOf(data).sort((a, b) => (data.totals?.[b.id] ?? 0) - (data.totals?.[a.id] ?? 0));
  const actions = snap.actions.filter((a) => a.meetingId === view.id);
  const avg = data.roti.responses ? data.roti.counts.reduce((sum, c, i) => sum + c * (i + 1), 0) / data.roti.responses : null;
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="muted">This retrospective has ended.{avg !== null && ` Return on time invested: ${avg.toFixed(1)} / 5.`}</p>
        <Button onClick={() => run(() => download(`/api/teams/${teamId}/meetings/${view.id}/summary.md`, 'retro.md'))}>
          <Icon name="download" /> Download summary
        </Button>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Topics</h2>
          <ol>
            {topics.map((t) => (
              <li key={t.id}>
                <strong>{t.title}</strong> ({data.totals?.[t.id] ?? 0})
                {data.notes[t.id] && <p className="small">{data.notes[t.id]}</p>}
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2>Actions</h2>
          {actions.length ? <ActionList actions={actions} teamId={teamId} compact /> : <p className="muted">None recorded.</p>}
        </section>
      </div>
    </div>
  );
}
