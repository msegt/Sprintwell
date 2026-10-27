import '../styles/finish.css';
import { MEETING_INFO, PHASES, type MeetingView } from '@sprintwell/shared';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { HowTo, StepHint } from '../components/Guide';
import { Avatar, Badge, Button, ConfirmButton, Icon, InlineEdit, Modal, formatDuration } from '../components/ui';
import { MEETING_GUIDES } from '../content/guides';
import { download } from '../lib/api';
import { useAction, useMeeting, useNotice, useNow, usePageTitle, useTeam } from '../lib/hooks';
import { DailyRoom } from './DailyRoom';
import { PairingRoom } from './PairingRoom';
import { PlanningRoom } from './PlanningRoom';
import { PokerRoom } from './PokerRoom';
import { RetroRoom } from './RetroRoom';
import { ReviewRoom } from './ReviewRoom';

export interface RoomCtx {
  view: MeetingView;
  send(cmd: Record<string, unknown> & { type: string }): Promise<boolean>;
  isFacilitator: boolean;
  ended: boolean;
  offset: number;
}

const Room = createContext<RoomCtx | null>(null);
export function useRoom(): RoomCtx {
  const r = useContext(Room);
  if (!r) throw new Error('useRoom outside a meeting');
  return r;
}

export function MeetingPage() {
  const { meetingId = '' } = useParams();
  const { teamId, me } = useTeam();
  const { view, missing, send, serverOffset } = useMeeting(teamId, meetingId);
  const { announce } = useNotice();
  usePageTitle(view?.title ?? 'Event');

  // Announce step changes to screen-reader users.
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    if (lastPhase.current && lastPhase.current !== view.phase) {
      announce(`Now: ${PHASES[view.kind].find((p) => p.id === view.phase)?.name ?? view.phase}`);
    }
    lastPhase.current = view.phase;
  }, [view, announce]);

  if (missing) {
    return (
      <div className="page narrow">
        <h1>Event not found</h1>
        <p>It may have been deleted.</p>
        <Link to={`/t/${teamId}/events`}>Back to events</Link>
      </div>
    );
  }
  if (!view) return <div className="page" aria-busy="true" aria-label="Connecting to the event" />;

  const ctx: RoomCtx = { view, send, isFacilitator: view.facilitatorId === me.id, ended: !!view.endedAt, offset: serverOffset.current };
  return (
    <Room.Provider value={ctx}>
      <div className={`page meeting meeting-${view.kind}`}>
        <MeetingHeader />
        <HowTo id={`event-${view.kind}`} guide={MEETING_GUIDES[view.kind]} />
        <div className="meeting-body">
          {view.kind === 'poker' && <PokerRoom />}
          {view.kind === 'retro' && <RetroRoom />}
          {view.kind === 'daily' && <DailyRoom />}
          {view.kind === 'planning' && <PlanningRoom />}
          {view.kind === 'review' && <ReviewRoom />}
          {view.kind === 'pairing' && <PairingRoom />}
        </div>
      </div>
    </Room.Provider>
  );
}

function MeetingHeader() {
  const { view, send, isFacilitator, ended } = useRoom();
  const { snap, teamId, name, isAdmin, me, readOnly } = useTeam();
  const run = useAction();
  const [manage, setManage] = useState(false);
  const phases = PHASES[view.kind];
  const idx = phases.findIndex((p) => p.id === view.phase);
  const facilitatorOnline = view.online.includes(view.facilitatorId);
  const canClaim = !readOnly && !isFacilitator && (!facilitatorOnline || isAdmin);

  return (
    <header className="meeting-head">
      <div className="row between wrap">
        <div>
          <p className="eyebrow">
            <Link to={`/t/${teamId}/events`}>Events</Link> / {MEETING_INFO[view.kind].name}
          </p>
          <h1 className="meeting-title-h">
            {isFacilitator && !ended ? <InlineEdit label="Event title" value={view.title} onSave={(v) => send({ type: 'rename', title: v })} /> : view.title}
            {ended && <Badge>Ended</Badge>}
          </h1>
        </div>
        <div className="row wrap">
          <Timer />
          <Button small onClick={() => setManage(true)}>
            Manage
          </Button>
        </div>
      </div>

      <div className="row between wrap meeting-meta">
        <ul className="presence" aria-label="Team members">
          {snap.team.members.map((m) => {
            const online = view.online.includes(m.userId);
            const fac = m.userId === view.facilitatorId;
            return (
              <li key={m.userId} title={`${m.displayName}${fac ? ', facilitator' : ''}${online ? ', here' : ', away'}`}>
                <Avatar id={m.userId} name={m.displayName} size={30} online={online} badge={fac ? <Icon name="star" size={10} /> : undefined} />
                <span className="sr-only">
                  {m.displayName}
                  {fac ? ' (facilitator)' : ''}
                  {online ? ', here' : ', away'}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="small muted">
          Facilitator: <strong>{name(view.facilitatorId)}</strong>
          {view.facilitatorId === me.id && ' (you)'}
          {canClaim && !ended && (
            <>
              {' '}
              <Button small variant="ghost" onClick={() => send({ type: 'claimFacilitator' })}>
                Take over
              </Button>
            </>
          )}
        </p>
      </div>

      {phases.length > 1 && (
        <nav aria-label="Steps" className="stepper-wrap">
          <ol className="stepper">
            {phases.map((p, i) => (
              <li key={p.id} className={i < idx ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
                {isFacilitator && !ended ? (
                  <button type="button" onClick={() => send({ type: 'setPhase', phase: p.id })}>
                    <span className="step-num">{i + 1}</span> {p.name}
                  </button>
                ) : (
                  <span>
                    <span className="step-num">{i + 1}</span> {p.name}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {isFacilitator && !ended && idx < phases.length - 1 && (
            <Button variant="primary" small onClick={() => send({ type: 'setPhase', phase: phases[idx + 1]!.id })}>
              Next: {phases[idx + 1]!.name} <Icon name="arrow" size={14} />
            </Button>
          )}
          {isFacilitator && !ended && idx === phases.length - 1 && <FinishButton small />}
        </nav>
      )}
      {phases.length <= 1 && isFacilitator && !ended && (
        <div className="row">
          <FinishButton small />
        </div>
      )}

      {!ended && idx === phases.length - 1 && <FinishCallout />}
      {ended && <EndedBanner />}

      <StepHint kind={view.kind} phase={view.phase} isFacilitator={isFacilitator} ended={ended} onStartTimer={(seconds) => void send({ type: 'timerStart', seconds })} />

      <Modal open={manage} onClose={() => setManage(false)} title="Manage this event" instant>
        <div className="stack">
          <Button onClick={() => run(() => download(`/api/teams/${teamId}/meetings/${view.id}/summary.md`, 'summary.md'))}>
            <Icon name="download" /> Download summary (Markdown)
          </Button>
          {(isFacilitator || isAdmin) && (
            <>
              <label className="field">
                <span>Hand facilitation to</span>
                <select
                  className="input"
                  value={view.facilitatorId}
                  onChange={(e) => {
                    void send({ type: 'handover', userId: e.target.value });
                  }}
                >
                  {snap.team.members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <p className="small muted">Rotating the facilitator is a good way to share Scrum Master skills across the team.</p>
              {ended ? (
                <Button onClick={() => send({ type: 'reopen' })}>Reopen event</Button>
              ) : (
                <ConfirmButton
                  variant="primary"
                  small={false}
                  confirmLabel="End for everyone"
                  onConfirm={async () => {
                    if (await send({ type: 'end' })) setManage(false);
                  }}
                >
                  End event
                </ConfirmButton>
              )}
            </>
          )}
        </div>
      </Modal>
    </header>
  );
}

/** Ends the event for everyone. Ending is reversible (Reopen), so it needs only one click. */
function FinishButton({ small }: { small?: boolean }) {
  const { send } = useRoom();
  const { notify } = useNotice();
  return (
    <Button
      variant="primary"
      small={small}
      className="finish-btn"
      onClick={async () => {
        if (await send({ type: 'end' })) notify('Event finished. Its summary is saved under Events.', 'success');
      }}
    >
      <Icon name="check" size={16} /> Finish event
    </Button>
  );
}

/** Shown on the last step so nobody has to hunt for how to end the event. */
function FinishCallout() {
  const { view, isFacilitator } = useRoom();
  const { name } = useTeam();
  const facilitatorHere = view.online.includes(view.facilitatorId);
  return (
    <div className="finish-callout" role="note">
      <span className="finish-icon" aria-hidden="true">
        <Icon name="flag" size={20} />
      </span>
      <div className="finish-text">
        <strong>Last step.</strong>{' '}
        {isFacilitator ? (
          <>When you have finished, choose Finish event. Everyone sees the summary, and actions appear on the Overview. You can reopen it later if needed.</>
        ) : facilitatorHere ? (
          <>{name(view.facilitatorId)} will finish the event when the team is done.</>
        ) : (
          <>The facilitator has left. Choose Take over above to finish the event.</>
        )}
      </div>
      {isFacilitator && <FinishButton />}
    </div>
  );
}

function EndedBanner() {
  const { view, send, isFacilitator } = useRoom();
  const { teamId, isAdmin } = useTeam();
  const run = useAction();
  return (
    <div className="ended-banner" role="status">
      <span className="finish-icon" aria-hidden="true">
        <Icon name="check" size={20} />
      </span>
      <div className="finish-text">
        <strong>This event has finished.</strong> Its summary is saved under Events, and any actions are on the Overview.
      </div>
      <div className="row wrap">
        <Button small onClick={() => run(() => download(`/api/teams/${teamId}/meetings/${view.id}/summary.md`, 'summary.md'))}>
          <Icon name="download" /> Summary
        </Button>
        <Link className="btn btn-secondary btn-small" to={`/t/${teamId}`}>
          Back to overview
        </Link>
        {(isFacilitator || isAdmin) && (
          <Button small variant="ghost" onClick={() => send({ type: 'reopen' })}>
            Reopen
          </Button>
        )}
      </div>
    </div>
  );
}

const PRESETS = [1, 2, 3, 5, 10, 15];

function Timer() {
  const { view, send, isFacilitator, offset } = useRoom();
  const { announce } = useNotice();
  const t = view.timer;
  const running = t.endsAt !== null;
  const now = useNow(running, offset);
  const remaining = running ? t.endsAt! - now : (t.pausedRemainingMs ?? 0);
  const expired = running && remaining <= 0;
  const active = running || t.pausedRemainingMs !== null;
  const [custom, setCustom] = useState('');
  const announced = useRef<number | null>(null);
  useEffect(() => {
    if (expired && announced.current !== t.endsAt) {
      announced.current = t.endsAt;
      announce('Time is up');
    }
  }, [expired, t.endsAt, announce]);

  const display = (
    <span role="timer" className={`timer${expired ? ' timer-expired' : ''}${running && remaining < 30_000 && !expired ? ' timer-soon' : ''}`} aria-label={active ? (expired ? 'Time is up' : `Timer ${formatDuration(remaining)}${running ? '' : ', paused'}`) : 'No timer'}>
      <Icon name="timer" size={16} />
      <span aria-hidden="true">{active ? (expired ? "Time's up" : formatDuration(remaining)) : '–:––'}</span>
    </span>
  );
  if (!isFacilitator) return display;
  return (
    <div className="timer-wrap">
      {display}
      {running && !expired && (
        <button type="button" className="icon-btn" aria-label="Pause timer" onClick={() => send({ type: 'timerPause' })}>
          <Icon name="pause" size={16} />
        </button>
      )}
      {!running && t.pausedRemainingMs !== null && (
        <button type="button" className="icon-btn" aria-label="Resume timer" onClick={() => send({ type: 'timerResume' })}>
          <Icon name="play" size={16} />
        </button>
      )}
      {active && (
        <button type="button" className="icon-btn" aria-label="Stop timer" onClick={() => send({ type: 'timerStop' })}>
          <Icon name="stop" size={16} />
        </button>
      )}
      <details className="timer-menu">
        <summary className="btn btn-ghost btn-small">Set timer</summary>
        <div className="timer-pop">
          {PRESETS.map((m) => (
            <Button key={m} small onClick={() => send({ type: 'timerStart', seconds: m * 60 })}>
              {m} min
            </Button>
          ))}
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(custom);
              if (n > 0) void send({ type: 'timerStart', seconds: Math.round(n * 60) });
            }}
          >
            <label className="sr-only" htmlFor="timer-custom">
              Minutes
            </label>
            <input id="timer-custom" className="input input-short" type="number" min={0.5} max={240} step={0.5} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="min" />
            <Button small type="submit">
              Start
            </Button>
          </form>
        </div>
      </details>
    </div>
  );
}
