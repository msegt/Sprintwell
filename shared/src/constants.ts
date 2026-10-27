/**
 * Product-wide constants. The product name lives here (and in web/index.html)
 * so a rename is a one-line change.
 */
export const APP_NAME = 'Sprintwell';

/** Input limits shared by client-side forms and server-side validation. */
export const LIMITS = {
  displayName: 40,
  teamName: 60,
  title: 200,
  shortText: 500,
  longText: 4000,
  cardText: 500,
  listItems: 50,
  cardsPerMeeting: 400,
  itemsPerPoker: 100,
  maxTimerSeconds: 4 * 60 * 60,
  /** Per-team caps that keep a single team from exhausting the server. */
  storiesPerTeam: 2000,
  actionsPerTeam: 2000,
  risksPerTeam: 500,
  charterItemsPerTeam: 300,
  sprintsPerTeam: 300,
  meetingsPerTeam: 5000,
  teamsPerPerson: 50,
} as const;

export const KERTH_PRIME_DIRECTIVE =
  'Regardless of what we discover, we understand and truly believe that everyone did the best job they could, given what they knew at the time, their skills and abilities, the resources available, and the situation at hand.';
export const KERTH_ATTRIBUTION = 'Norm Kerth, Project Retrospectives: A Handbook for Team Reviews';

/** Bill Wake's INVEST checklist for user stories. */
export const INVEST = [
  { key: 'I', name: 'Independent', hint: 'Can be developed and delivered without waiting on another story.' },
  { key: 'N', name: 'Negotiable', hint: 'Details can still be discussed with the Product Owner or client.' },
  { key: 'V', name: 'Valuable', hint: 'Delivers clear value to a user or the client.' },
  { key: 'E', name: 'Estimable', hint: 'The team understands it well enough to estimate it.' },
  { key: 'S', name: 'Small', hint: 'Fits comfortably in a sprint; ideally a day or two of work.' },
  { key: 'T', name: 'Testable', hint: 'Has acceptance criteria that tell you when it is done.' },
] as const;
export type InvestKey = (typeof INVEST)[number]['key'];

/** Starter content offered when a team creates its charter. Teams edit freely. */
export const STARTER_DOR = [
  'The user story is clearly written (As a… I want… so that…)',
  'Acceptance criteria are defined',
  'Dependencies are identified',
  'The team understands what to build',
  'The story is estimated',
  'Nothing blocks work from starting',
];
export const STARTER_DOD = [
  'Code is committed to a feature branch linked to the story',
  'Reviewed by at least one teammate through a merge request',
  'Automated tests pass',
  'Acceptance criteria are met',
  'Merged into main',
  'Deployed to staging or production',
  'Documentation updated',
];
export const STARTER_AGREEMENT = [
  'We start and finish our Scrum events on time',
  'We keep each other informed when we are blocked or unavailable',
  'Every voice is heard: we use silent writing and round-robins',
  'We disagree respectfully and decide together',
  'We review the agreement at every retrospective',
];

export const MEETING_KINDS = ['poker', 'retro', 'daily', 'planning', 'review', 'pairing'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_INFO: Record<MeetingKind, { name: string; summary: string; timebox: string }> = {
  planning: {
    name: 'Sprint Planning',
    summary: 'Agree WHY the sprint is valuable (Sprint Goal), WHAT can be done (capacity and stories) and HOW (tasks).',
    timebox: 'Up to 8 hours for a one-month sprint; usually shorter.',
  },
  poker: {
    name: 'Planning Poker',
    summary: 'Estimate stories together with hidden, simultaneous votes, then discuss the outliers.',
    timebox: 'A few minutes per story.',
  },
  daily: {
    name: 'Daily Scrum',
    summary: 'Inspect progress towards the Sprint Goal and adapt the plan for the next day.',
    timebox: '15 minutes.',
  },
  review: {
    name: 'Sprint Review',
    summary: 'Inspect the increment with stakeholders, gather feedback and adapt the Product Backlog.',
    timebox: 'Up to 4 hours for a one-month sprint; usually shorter.',
  },
  retro: {
    name: 'Sprint Retrospective',
    summary: 'Inspect how the sprint went (people, interactions, processes, tools, Definition of Done) and agree improvements.',
    timebox: 'Up to 3 hours for a one-month sprint; 45–90 minutes is typical for two weeks.',
  },
  pairing: {
    name: 'Pairing timer',
    summary: 'Rotate driver and navigator roles on a timer for pair or mob programming.',
    timebox: 'Short rotations, typically 5–15 minutes.',
  },
};

export const PHASES: Record<MeetingKind, readonly { id: string; name: string }[]> = {
  poker: [
    { id: 'estimate', name: 'Estimate' },
    { id: 'summary', name: 'Summary' },
  ],
  retro: [
    { id: 'checkin', name: 'Check-in' },
    { id: 'review', name: 'Previous actions' },
    { id: 'reflect', name: 'Reflect' },
    { id: 'group', name: 'Group' },
    { id: 'vote', name: 'Vote' },
    { id: 'discuss', name: 'Discuss' },
    { id: 'close', name: 'Close' },
  ],
  daily: [
    { id: 'updates', name: 'Updates' },
    { id: 'parking', name: 'After the Daily Scrum' },
  ],
  planning: [
    { id: 'why', name: 'Why: Sprint Goal' },
    { id: 'what', name: 'What: select stories' },
    { id: 'how', name: 'How: plan the work' },
    { id: 'commit', name: 'Confirm' },
  ],
  review: [
    { id: 'increment', name: 'Inspect the increment' },
    { id: 'feedback', name: 'Feedback' },
    { id: 'adapt', name: 'Adapt' },
  ],
  pairing: [{ id: 'pairing', name: 'Pairing' }],
};

export const RISK_CATEGORIES = ['legal', 'ethical', 'social', 'professional', 'security', 'technical', 'other'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const ESVP = [
  { id: 'explorer', name: 'Explorer', hint: 'Eager to discover new ideas and insights.' },
  { id: 'shopper', name: 'Shopper', hint: 'Will happily take away one or two useful things.' },
  { id: 'vacationer', name: 'Vacationer', hint: 'Glad to have a break from the day-to-day.' },
  { id: 'prisoner', name: 'Prisoner', hint: 'Would rather be somewhere else.' },
] as const;
export type EsvpId = (typeof ESVP)[number]['id'];
