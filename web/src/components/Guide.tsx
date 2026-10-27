import type { MeetingKind, TeamSnapshot } from '@sprintwell/shared';
import '../styles/guide-more.css';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { PHASE_HINTS, type Guide, type GuideLink } from '../content/guides';
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
export function GuideBody({ guide, full }: { guide: Guide; full?: boolean }) {
  const hasMore = !!(guide.prepare?.length || guide.pitfalls?.length || guide.links?.length);
  const more = <GuideMore guide={guide} />;
  return (
    <>
      <p className="guide-purpose">{guide.purpose}</p>
      {full && guide.prepare && <List title="Before you start" items={guide.prepare} />}
      <p className="guide-tips-title">{full && guide.prepare ? 'During the event' : 'Steps'}</p>
      <ol className="guide-steps">
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {guide.tips && guide.tips.length > 0 && <List title="Tips" items={guide.tips} />}
      {full ? (
        <>
          {guide.pitfalls && <List title="Watch out for" items={guide.pitfalls} />}
          {guide.links && <Links links={guide.links} />}
        </>
      ) : (
        hasMore && (
          <details className="guide-more">
            <summary>Preparation, common pitfalls and further reading</summary>
            {more}
          </details>
        )
      )}
    </>
  );
}

function GuideMore({ guide }: { guide: Guide }) {
  return (
    <>
      {guide.prepare && <List title="Before you start" items={guide.prepare} />}
      {guide.pitfalls && <List title="Watch out for" items={guide.pitfalls} />}
      {guide.links && <Links links={guide.links} />}
    </>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <p className="guide-tips-title">{title}</p>
      <ul className="guide-tips">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </>
  );
}

export function Links({ links, title = 'Further reading' }: { links: GuideLink[]; title?: string }) {
  return (
    <>
      <p className="guide-tips-title">{title}</p>
      <ul className="guide-links">
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.title}
              <span className="sr-only"> (opens in a new tab)</span> <Icon name="external" size={12} />
            </a>{' '}
            <span className="muted small">{l.source}</span>
          </li>
        ))}
      </ul>
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
