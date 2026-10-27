import { MEETING_INFO, PHASES, type ActivityKind } from '@sprintwell/shared';
import type { ActivityEntry } from '../activity';
import type { MeetingRecord } from './engine';

const KIND_OF: Record<MeetingRecord['kind'], ActivityKind> = {
  poker: 'estimate',
  retro: 'retro',
  daily: 'daily',
  planning: 'planning',
  review: 'review',
  pairing: 'pairing',
};

const q = (s: string) => `“${s.length > 120 ? `${s.slice(0, 117)}…` : s}”`;

/**
 * What to record in the activity log for a meeting command, if anything.
 *
 * Privacy rules: nothing is recorded that would reveal what the team keeps
 * hidden or anonymous. Poker votes are logged as "voted" without the value;
 * cards in anonymous retrospectives, retrospective dot votes, the ESVP safety
 * check and the closing rating are never attributed to anyone.
 */
export function describeCommand(before: MeetingRecord, after: MeetingRecord, actorId: string, cmd: { type: string } & Record<string, unknown>): Omit<ActivityEntry, 'teamId'>[] {
  const kind = KIND_OF[before.kind];
  const title = q(after.title);
  const entry = (summary: string, dedupe?: string): Omit<ActivityEntry, 'teamId'> => ({ userId: actorId, kind, summary, dedupe });
  const s = after.state as Record<string, unknown>;

  switch (cmd.type) {
    case 'end':
      return [entry(`finished ${MEETING_INFO[before.kind].name} ${title} as facilitator`)];
    case 'setPhase': {
      const phase = PHASES[before.kind].find((p) => p.id === cmd.phase)?.name;
      return phase ? [entry(`facilitated ${title}: moved to ${phase}`, `phase:${before.id}:${cmd.phase}`)] : [];
    }
    case 'handover':
      return [entry(`handed facilitation of ${title} to someone else`)];
    case 'claimFacilitator':
      return [entry(`took over facilitating ${title}`)];
  }

  if (before.kind === 'poker') {
    const items = (s.items ?? []) as { id: string; title: string; round: number; finalEstimate: string | null }[];
    const current = items.find((i) => i.id === (s.currentItemId as string));
    if (cmd.type === 'vote' && cmd.value !== null && current) return [entry(`voted on ${q(current.title)} (round ${current.round})`, `vote:${before.id}:${current.id}:${current.round}:${actorId}`)];
    if (cmd.type === 'finalise' && current) return [entry(`saved the estimate ${String(cmd.value)} for ${q(current.title)}`)];
    if (cmd.type === 'addItems') return [entry(`added stories to estimate in ${title}`)];
    return [];
  }

  if (before.kind === 'retro') {
    const anonymous = s.anonymous === true;
    if (cmd.type === 'checkin') return [entry(`checked in to ${title}`, `checkin:${before.id}:${actorId}`)];
    if (cmd.type === 'addCard' && !anonymous) return [entry(`wrote a retrospective card: ${q(String(cmd.text))}`)];
    if (cmd.type === 'addCard' && anonymous) return [];
    if (cmd.type === 'note') return [entry(`took discussion notes in ${title}`, `note:${before.id}:${String(cmd.topicId)}:${actorId}`)];
    if (cmd.type === 'group' || cmd.type === 'renameGroup') return [entry(`helped group the cards in ${title}`, `group:${before.id}:${actorId}`)];
    return [];
  }

  if (before.kind === 'daily') {
    if (cmd.type === 'setUpdate') {
      const parts = [cmd.yesterday && `done: ${String(cmd.yesterday)}`, cmd.today && `next: ${String(cmd.today)}`, cmd.blockers && `blocked by: ${String(cmd.blockers)}`].filter(Boolean);
      return parts.length ? [entry(`gave a Daily Scrum update (${parts.join('; ')})`, `update:${before.id}:${actorId}`)] : [];
    }
    if (cmd.type === 'addParking') return [entry(`parked a topic for after the Daily Scrum: ${q(String(cmd.text))}`)];
    return [];
  }

  if (before.kind === 'planning') {
    if (cmd.type === 'setCapacity') return [entry(`updated capacity in ${title}`, `capacity:${before.id}:${actorId}`)];
    if (cmd.type === 'setNotes') return [entry(`took planning notes in ${title}`, `pnotes:${before.id}:${actorId}`)];
    return [];
  }

  if (before.kind === 'review') {
    if (cmd.type === 'addFeedback') return [entry(`recorded stakeholder feedback: ${q(String(cmd.text))}`)];
    if (cmd.type === 'setDemoed' && cmd.demoed === true) return [entry(`marked a story as demonstrated in ${title}`)];
    if (cmd.type === 'markFeedbackAdded') return [entry('turned review feedback into a backlog item')];
    return [];
  }

  if (before.kind === 'pairing') {
    if (cmd.type === 'startRotation' || cmd.type === 'setParticipants') return [entry(`set up a pairing session in ${title}`, `pairing:${before.id}:${actorId}`)];
    return [];
  }
  return [];
}

/** "Took part in…" is recorded once per person per event. */
export function attendance(record: MeetingRecord, userId: string): ActivityEntry {
  return {
    teamId: record.teamId,
    userId,
    kind: KIND_OF[record.kind],
    summary: `took part in ${MEETING_INFO[record.kind].name} “${record.title}”`,
    dedupe: `attend:${record.id}:${userId}`,
  };
}
