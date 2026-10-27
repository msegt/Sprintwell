import type { MeetingKind, TeamSnapshot } from '@sprintwell/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PHASE_HINTS, type Guide } from '../content/guides';
import { Button, Icon } from './ui';

const KEY = 'sprintwell.guide.';

function readPref(id: string): string | null {
  try {
    return localStorage.getItem(KEY + id);
  } catch {
    return null;
  }
}

function writePref(id: string, value: string): void {
  try {
    localStorage.setItem(KEY + id, value);
  } catch {
    /* storage unavailable: the guide simply opens again next time */
  }
}

/** The steps and tips of a guide, without the surrounding panel. */
export function GuideBody({ guide }: { guide: Guide }) {
  return (
    <>
      <p className="guide-purpose">{guide.purpose}</p>
      <ol className="guide-steps">
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {guide.tips && guide.tips.length > 0 && (
        <>
          <p className="guide-tips-title">Tips</p>
          <ul className="guide-tips">
            {guide.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/**
 * A collapsible “How this works” panel. It starts open the first time someone
 * visits a section and remembers if they close it (in this browser only).
 */
export function HowTo({ id, guide }: { id: string; guide: Guide }) {
  const [open, setOpen] = useState(() => readPref(id) !== 'closed');
  return (
    <details
      className="howto"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        writePref(id, now ? 'open' : 'closed');
      }}
    >
      <summary>
        <Icon name="info" size={16} /> <span>{guide.title}</span>
        <span className="howto-toggle muted small">{open ? 'Hide' : 'Show'}</span>
      </summary>
      <div className="howto-body">
        <GuideBody guide={guide} />
        <p className="small">
          <Link to="/guide">All guides</Link>
        </p>
      </div>
    </details>
  );
}

/** One line telling people what to do in the current step of an event. */
export function StepHint({ kind, phase, isFacilitator, ended, onStartTimer, extra }: { kind: MeetingKind; phase: string; isFacilitator: boolean; ended: boolean; onStartTimer(seconds: number): void; extra?: ReactNode }) {
  const hint = PHASE_HINTS[kind][phase];
  if (!hint || ended) return null;
  return (
    <div className="step-hint" role="note" aria-label="What to do now">
      <p>
        <strong>{isFacilitator ? 'You are facilitating: ' : 'Now: '}</strong>
        {isFacilitator ? hint.facilitator : hint.everyone}
        {hint.minutes && <span className="muted"> Suggested time: {hint.minutes} min.</span>}
      </p>
      {isFacilitator && hint.minutes && (
        <Button small onClick={() => onStartTimer(hint.minutes! * 60)}>
          <Icon name="timer" size={14} /> Start {hint.minutes}-min timer
        </Button>
      )}
      {extra}
    </div>
  );
}

interface Step {
  done: boolean;
  label: string;
  to: string;
  hint: string;
}

/** A checklist for new teams, ticked automatically from the team's data. */
export function GettingStarted({ snap, teamId }: { snap: TeamSnapshot; teamId: string }) {
  const key = `start.${teamId}`;
  const [hidden, setHidden] = useState(() => readPref(key) === 'hidden');
  const kinds = new Set(snap.meetings.map((m) => m.kind));
  const steps: Step[] = [
    { done: snap.team.members.length > 1, label: 'Invite your team', to: `/t/${teamId}/settings`, hint: 'Share the invite link from the Team page.' },
    { done: snap.charter.some((c) => c.updatedBy !== null), label: 'Agree your team charter', to: `/t/${teamId}/charter`, hint: 'Edit the working agreement, Definition of Ready and Definition of Done.' },
    { done: snap.stories.length >= 3, label: 'Write some user stories', to: `/t/${teamId}/backlog`, hint: 'Add at least three stories to the Product Backlog.' },
    { done: snap.stories.some((s) => s.estimate), label: 'Estimate with Planning Poker', to: `/t/${teamId}/backlog`, hint: 'Select stories in the backlog, then Estimate with Planning Poker.' },
    { done: snap.sprints.some((s) => s.status !== 'planned'), label: 'Plan and start a sprint', to: `/t/${teamId}/events`, hint: 'Run Sprint Planning and start the sprint.' },
    { done: kinds.has('daily'), label: 'Hold a Daily Scrum', to: `/t/${teamId}/events`, hint: 'Fifteen minutes, every working day.' },
    { done: kinds.has('review') && kinds.has('retro'), label: 'Finish with a Sprint Review and a Retrospective', to: `/t/${teamId}/events`, hint: 'Review the increment with your client, then reflect as a team.' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (hidden || doneCount === steps.length) return null;
  return (
    <section className="card getting-started" aria-labelledby="gs-h">
      <div className="row between wrap">
        <h2 id="gs-h">Getting started</h2>
        <span className="small muted">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="gs-list">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="gs-mark" aria-hidden="true">
              {s.done ? <Icon name="check" size={14} /> : null}
            </span>
            <span>
              <Link to={s.to}>{s.label}</Link>
              <span className="sr-only">{s.done ? ' (done)' : ' (not done yet)'}</span>
              <span className="block small muted">{s.hint}</span>
            </span>
          </li>
        ))}
      </ol>
      <Button
        small
        variant="ghost"
        onClick={() => {
          setHidden(true);
          writePref(key, 'hidden');
        }}
      >
        Hide this checklist
      </Button>
    </section>
  );
}
