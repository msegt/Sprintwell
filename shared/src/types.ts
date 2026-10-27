import type { EsvpId, InvestKey, MeetingKind, RiskCategory } from './constants';
import type { ItemKind } from './ready';
import type { PokerStats } from './poker';
import type { RetroColumn } from './templates';

// ---------------------------------------------------------------------------
// Team data (REST)
// ---------------------------------------------------------------------------

export interface UserDTO {
  id: string;
  displayName: string;
  /** Email sign-in is planned; false for every v1 user. */
  hasEmail: boolean;
}

export type TeamRole = 'admin' | 'member';

export interface MemberDTO {
  userId: string;
  displayName: string;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamSettings {
  defaultDeck: string;
  /** Estimates at or above this value get a "consider splitting" hint. */
  splitThreshold: number;
  sprintLengthDays: number;
  retroVotesPerPerson: number;
  /** Optional link to the team's issue tracker board (e.g. a GitLab project). */
  trackerUrl: string;
  /** Only items that meet the Definition of Ready (and, for user stories, INVEST and the story format) can enter a sprint. */
  enforceReady: boolean;
}

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  defaultDeck: 'fibonacci',
  splitThreshold: 8,
  sprintLengthDays: 14,
  retroVotesPerPerson: 3,
  trackerUrl: '',
  enforceReady: true,
};

export interface TeamSummaryDTO {
  id: string;
  name: string;
  role: TeamRole;
  memberCount: number;
}

export interface TeamDTO {
  id: string;
  name: string;
  inviteCode: string;
  createdAt: string;
  settings: TeamSettings;
  members: MemberDTO[];
  myRole: TeamRole;
}

export type CharterKind = 'agreement' | 'dor' | 'dod';

export interface CharterItemDTO {
  id: string;
  kind: CharterKind;
  text: string;
  position: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface CapacityRow {
  userId: string;
  daysAvailable: number;
  hoursPerDay: number;
  /** 0–100; e.g. 70 for someone new to the team. */
  focusPercent: number;
}

export type SprintStatus = 'planned' | 'active' | 'closed';
export type GoalMet = 'yes' | 'partly' | 'no';

export interface SprintDTO {
  id: string;
  name: string;
  goal: string;
  startDate: string | null;
  endDate: string | null;
  status: SprintStatus;
  goalMet: GoalMet | null;
  capacity: CapacityRow[];
  createdAt: string;
  closedAt: string | null;
}

export type StoryStatus = 'backlog' | 'todo' | 'doing' | 'done';

export interface TaskDTO {
  id: string;
  text: string;
  done: boolean;
  ownerId: string | null;
}

export interface StoryDTO {
  id: string;
  sprintId: string | null;
  /** User story, bug, spike or technical task. Only user stories need the story format and INVEST. */
  kind: ItemKind;
  title: string;
  asA: string;
  iWant: string;
  soThat: string;
  acceptanceCriteria: string[];
  notes: string;
  estimate: string | null;
  status: StoryStatus;
  invest: Partial<Record<InvestKey, boolean>>;
  /** Definition of Ready checks, keyed by charter item id. */
  dor: Record<string, boolean>;
  externalUrl: string;
  tasks: TaskDTO[];
  ownerId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  doneAt: string | null;
}

export type ActionKind = 'action' | 'impediment';
export type ActionStatus = 'open' | 'done';

export interface ActionDTO {
  id: string;
  kind: ActionKind;
  text: string;
  ownerId: string | null;
  dueDate: string | null;
  status: ActionStatus;
  meetingId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type RiskLevel = 1 | 2 | 3;
export type RiskStatus = 'open' | 'mitigated' | 'closed';

export interface RiskDTO {
  id: string;
  title: string;
  description: string;
  category: RiskCategory;
  likelihood: RiskLevel;
  impact: RiskLevel;
  countermeasure: string;
  ownerId: string | null;
  status: RiskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingSummaryDTO {
  id: string;
  kind: MeetingKind;
  title: string;
  sprintId: string | null;
  facilitatorId: string;
  phase: string;
  createdAt: string;
  endedAt: string | null;
}

export interface TeamSnapshot {
  team: TeamDTO;
  charter: CharterItemDTO[];
  sprints: SprintDTO[];
  stories: StoryDTO[];
  actions: ActionDTO[];
  risks: RiskDTO[];
  meetings: MeetingSummaryDTO[];
}

// ---------------------------------------------------------------------------
// Meetings (real time)
// ---------------------------------------------------------------------------

export interface TimerState {
  /** Epoch ms when the countdown ends while running; null when stopped or paused. */
  endsAt: number | null;
  /** Remaining ms while paused; null otherwise. */
  pausedRemainingMs: number | null;
  durationMs: number;
}

export interface PokerItemView {
  id: string;
  storyId: string | null;
  title: string;
  finalEstimate: string | null;
  round: number;
  revealed: boolean;
  /** Who has voted in the current round (values hidden until reveal). */
  voted: string[];
  myVote: string | null;
  /** All votes, only once revealed. */
  votes: Record<string, string> | null;
  stats: PokerStats | null;
  /** Earlier revealed rounds, kept so the team can see how opinions moved. */
  history: { round: number; votes: Record<string, string> }[];
}

export interface PokerView {
  deckId: string;
  deck: string[];
  autoReveal: boolean;
  observers: string[];
  items: PokerItemView[];
  currentItemId: string | null;
}

export interface RetroCardView {
  id: string;
  columnId: string;
  text: string;
  groupId: string | null;
  mine: boolean;
  /** Only present when the retrospective is not anonymous. */
  authorId?: string;
}

export interface RetroGroupView {
  id: string;
  columnId: string;
  title: string;
}

export interface RetroView {
  templateId: string;
  columns: RetroColumn[];
  anonymous: boolean;
  votesPerPerson: number;
  checkinQuestion: string;
  checkins: { userId: string; word: string }[];
  /** ESVP safety check: counts only, never who chose what. */
  esvp: Record<EsvpId, number>;
  myEsvp: EsvpId | null;
  cards: RetroCardView[];
  /** Cards other people wrote while still hidden (reflect phase). */
  hiddenCounts: Record<string, number>;
  groups: RetroGroupView[];
  myVotes: Record<string, number>;
  votesRemaining: number;
  /** Vote totals per topic, shown from the discuss phase onwards. */
  totals: Record<string, number> | null;
  voterCount: number;
  currentTopicId: string | null;
  notes: Record<string, string>;
  roti: { counts: number[]; mine: number | null; responses: number };
}

export interface DailyUpdate {
  yesterday: string;
  today: string;
  blockers: string;
}

export interface DailyView {
  order: string[];
  current: number;
  perPersonSeconds: number;
  updates: Record<string, DailyUpdate>;
  parking: { id: string; text: string; authorId: string }[];
  done: string[];
}

export interface PlanningView {
  capacity: CapacityRow[];
  notes: string;
}

export interface ReviewFeedback {
  id: string;
  text: string;
  from: string;
  storyId: string | null;
  backlogStoryId: string | null;
}

export interface ReviewView {
  demoed: string[];
  feedback: ReviewFeedback[];
  notes: string;
}

export type PairingMode = 'driver-navigator' | 'strong-style' | 'ping-pong' | 'mob';

export interface PairingView {
  mode: PairingMode;
  participants: string[];
  driverIndex: number;
  intervalSeconds: number;
  rotations: number;
  autoRotate: boolean;
}

export interface MeetingViewBase {
  id: string;
  teamId: string;
  title: string;
  phase: string;
  facilitatorId: string;
  sprintId: string | null;
  timer: TimerState;
  createdAt: string;
  endedAt: string | null;
  online: string[];
  serverNow: number;
}

export type MeetingView =
  | (MeetingViewBase & { kind: 'poker'; data: PokerView })
  | (MeetingViewBase & { kind: 'retro'; data: RetroView })
  | (MeetingViewBase & { kind: 'daily'; data: DailyView })
  | (MeetingViewBase & { kind: 'planning'; data: PlanningView })
  | (MeetingViewBase & { kind: 'review'; data: ReviewView })
  | (MeetingViewBase & { kind: 'pairing'; data: PairingView });

// ---------------------------------------------------------------------------
// WebSocket protocol
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'sub'; teamId: string }
  | { t: 'unsub'; teamId: string }
  | { t: 'join'; meetingId: string }
  | { t: 'leave'; meetingId: string }
  | { t: 'cmd'; meetingId: string; id: number; cmd: unknown }
  | { t: 'ping' };

export type ServerMessage =
  | { t: 'ready'; userId: string }
  | { t: 'team'; teamId: string }
  | { t: 'meeting'; view: MeetingView }
  | { t: 'ack'; id: number; ok: boolean; error?: string }
  | { t: 'error'; error: string }
  | { t: 'pong' };
