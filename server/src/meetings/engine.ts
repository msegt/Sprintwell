import type { MeetingKind, MemberDTO, TeamSettings, TimerState } from '@sprintwell/shared';
import type { ZodType } from 'zod';
import type { Repo } from '../repo';

/** A user-facing error raised when a command is not allowed. */
export class MeetingError extends Error {}

export interface MeetingRecord<S = unknown> {
  id: string;
  teamId: string;
  kind: MeetingKind;
  title: string;
  sprintId: string | null;
  facilitatorId: string;
  phase: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  timer: TimerState;
  state: S;
}

export interface EngineCtx<S> {
  meeting: MeetingRecord<S>;
  /** Mutable copy of the state; changes are committed only if the command succeeds. */
  state: S;
  actorId: string;
  isFacilitator: boolean;
  isAdmin: boolean;
  /** People currently connected to the meeting. */
  online: string[];
  members: MemberDTO[];
  repo: Repo;
  /** Call when the command changed team data (stories, sprints…) so other screens refresh. */
  touchTeam(): void;
  startTimer(seconds: number): void;
  stopTimer(): void;
}

export interface CreateInput {
  teamId: string;
  actorId: string;
  sprintId: string | null;
  options: Record<string, unknown>;
  members: MemberDTO[];
  settings: TeamSettings;
  repo: Repo;
}

export interface Engine<S, C extends { type: string }, V> {
  kind: MeetingKind;
  schema: ZodType<C>;
  /** Command types only the facilitator may send. */
  facilitatorOnly: ReadonlySet<C['type']>;
  defaultTitle(input: CreateInput): Promise<string> | string;
  create(input: CreateInput): Promise<{ state: S; sprintId?: string | null }> | { state: S; sprintId?: string | null };
  apply(ctx: EngineCtx<S>, cmd: C): Promise<void> | void;
  view(state: S, viewerId: string, meeting: MeetingRecord<S>, online: string[]): V;
  /** Called when the timer reaches zero. Return true if the state changed. */
  onTimerEnd?(ctx: EngineCtx<S>): boolean;
  /** Called when someone joins or leaves. Return true if the state changed. */
  onPresence?(ctx: EngineCtx<S>): boolean;
  /** Markdown summary of the meeting for exports and portfolios. */
  summary(state: S, meeting: MeetingRecord<S>, names: (id: string | null | undefined) => string): string;
}

export function requirePhase(ctx: EngineCtx<unknown>, ...phases: string[]): void {
  if (!phases.includes(ctx.meeting.phase)) {
    throw new MeetingError('That is not available in this part of the meeting.');
  }
}

export function md(text: string): string {
  // Escape characters that would change the meaning of Markdown in summaries.
  return text.replace(/([\\`*_[\]#|<>])/g, '\\$1').replace(/\r?\n/g, ' ');
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
