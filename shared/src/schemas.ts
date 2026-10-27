import { z } from 'zod';
import { ESVP, INVEST, LIMITS, MEETING_KINDS, RISK_CATEGORIES } from './constants';

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .nullable();
const url = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Links must start with http:// or https://');

// ---------------------------------------------------------------------------
// REST bodies
// ---------------------------------------------------------------------------

export const createSessionBody = z.object({ displayName: required(LIMITS.displayName) });
export const updateMeBody = z.object({ displayName: required(LIMITS.displayName) });

export const teamSettingsBody = z.object({
  defaultDeck: z.string().max(40).optional(),
  splitThreshold: z.number().int().min(1).max(1000).optional(),
  sprintLengthDays: z.number().int().min(1).max(60).optional(),
  retroVotesPerPerson: z.number().int().min(1).max(20).optional(),
  trackerUrl: url.optional(),
  enforceReady: z.boolean().optional(),
});

export const createTeamBody = z.object({
  name: required(LIMITS.teamName),
  starterCharter: z.boolean().default(true),
});

export const updateTeamBody = z.object({
  name: required(LIMITS.teamName).optional(),
  settings: teamSettingsBody.optional(),
});

export const joinTeamBody = z.object({ code: z.string().trim().min(4).max(32) });
export const setRoleBody = z.object({ role: z.enum(['admin', 'member']) });

export const charterItemBody = z.object({
  kind: z.enum(['agreement', 'dor', 'dod']),
  text: required(LIMITS.shortText),
});
export const charterUpdateBody = z.object({ text: required(LIMITS.shortText) });
export const reorderBody = z.object({ ids: z.array(id).max(500) });

const taskSchema = z.object({
  id,
  text: required(LIMITS.shortText),
  done: z.boolean(),
  ownerId: id.nullable(),
});

const investKeys = INVEST.map((i) => i.key) as [string, ...string[]];

const storyFields = {
  kind: z.enum(['story', 'bug', 'spike', 'task']),
  title: required(LIMITS.title),
  asA: text(LIMITS.shortText),
  iWant: text(LIMITS.shortText),
  soThat: text(LIMITS.shortText),
  acceptanceCriteria: z.array(required(LIMITS.shortText)).max(LIMITS.listItems),
  notes: text(LIMITS.longText),
  estimate: z.string().trim().max(10).nullable(),
  status: z.enum(['backlog', 'todo', 'doing', 'done']),
  sprintId: id.nullable(),
  invest: z.partialRecord(z.enum(investKeys), z.boolean()),
  dor: z.record(id, z.boolean()).refine((r) => Object.keys(r).length <= 100, 'Too many Definition of Ready items'),
  externalUrl: url,
  tasks: z.array(taskSchema).max(LIMITS.listItems),
  ownerId: id.nullable(),
};

export const storyBody = z.object({
  ...storyFields,
  kind: storyFields.kind.default('story'),
  asA: storyFields.asA.default(''),
  iWant: storyFields.iWant.default(''),
  soThat: storyFields.soThat.default(''),
  acceptanceCriteria: storyFields.acceptanceCriteria.default([]),
  notes: storyFields.notes.default(''),
  estimate: storyFields.estimate.default(null),
  status: storyFields.status.default('backlog'),
  sprintId: storyFields.sprintId.default(null),
  invest: storyFields.invest.default({}),
  dor: storyFields.dor.default({}),
  externalUrl: storyFields.externalUrl.default(''),
  tasks: storyFields.tasks.default([]),
  ownerId: storyFields.ownerId.default(null),
});
/** PATCH bodies must not have defaults, or omitted fields would be reset. */
export const storyPatchBody = z.object(storyFields).partial();

export const bulkStoriesBody = z.object({
  stories: z
    .array(
      z.object({
        title: required(LIMITS.title),
        notes: text(LIMITS.longText).default(''),
        externalUrl: url.default(''),
        estimate: z.string().trim().max(10).nullable().default(null),
      }),
    )
    .min(1)
    .max(200),
});

export const sprintBody = z.object({
  name: required(LIMITS.title),
  goal: text(LIMITS.shortText).default(''),
  startDate: isoDate.default(null),
  endDate: isoDate.default(null),
});
export const sprintPatchBody = z.object({
  name: required(LIMITS.title).optional(),
  goal: text(LIMITS.shortText).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  status: z.enum(['planned', 'active', 'closed']).optional(),
  goalMet: z.enum(['yes', 'partly', 'no']).nullable().optional(),
});

export const actionBody = z.object({
  kind: z.enum(['action', 'impediment']).default('action'),
  text: required(LIMITS.shortText),
  ownerId: id.nullable().default(null),
  dueDate: isoDate.default(null),
});
export const actionPatchBody = z.object({
  text: required(LIMITS.shortText).optional(),
  ownerId: id.nullable().optional(),
  dueDate: isoDate.optional(),
  status: z.enum(['open', 'done']).optional(),
});

const level = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const riskFields = {
  title: required(LIMITS.title),
  description: text(LIMITS.longText),
  category: z.enum(RISK_CATEGORIES),
  likelihood: level,
  impact: level,
  countermeasure: text(LIMITS.longText),
  ownerId: id.nullable(),
  status: z.enum(['open', 'mitigated', 'closed']),
};
export const riskBody = z.object({
  ...riskFields,
  description: riskFields.description.default(''),
  category: riskFields.category.default('technical'),
  likelihood: riskFields.likelihood.default(2),
  impact: riskFields.impact.default(2),
  countermeasure: riskFields.countermeasure.default(''),
  ownerId: riskFields.ownerId.default(null),
  status: riskFields.status.default('open'),
});
export const riskPatchBody = z.object(riskFields).partial();

export const createMeetingBody = z.object({
  kind: z.enum(MEETING_KINDS),
  title: text(LIMITS.title).optional(),
  sprintId: id.nullable().optional(),
  // Kind-specific options; validated by each meeting engine.
  options: z.record(z.string(), z.unknown()).default({}),
});

export const deviceLinkRedeemBody = z.object({ code: z.string().trim().min(6).max(32) });

// ---------------------------------------------------------------------------
// Meeting commands (WebSocket)
// ---------------------------------------------------------------------------

export const commonCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setPhase'), phase: z.string().max(40) }),
  z.object({ type: z.literal('timerStart'), seconds: z.number().int().min(1).max(LIMITS.maxTimerSeconds) }),
  z.object({ type: z.literal('timerPause') }),
  z.object({ type: z.literal('timerResume') }),
  z.object({ type: z.literal('timerStop') }),
  z.object({ type: z.literal('handover'), userId: id }),
  z.object({ type: z.literal('claimFacilitator') }),
  z.object({ type: z.literal('rename'), title: required(LIMITS.title) }),
  z.object({ type: z.literal('end') }),
  z.object({ type: z.literal('reopen') }),
]);
export type CommonCommand = z.infer<typeof commonCommand>;

export const pokerCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addItems'), titles: z.array(required(LIMITS.title)).max(LIMITS.itemsPerPoker).default([]), storyIds: z.array(id).max(LIMITS.itemsPerPoker).default([]) }),
  z.object({ type: z.literal('removeItem'), itemId: id }),
  z.object({ type: z.literal('selectItem'), itemId: id }),
  z.object({ type: z.literal('vote'), value: z.string().max(10).nullable() }),
  z.object({ type: z.literal('reveal') }),
  z.object({ type: z.literal('revote') }),
  z.object({ type: z.literal('finalise'), value: z.string().trim().min(1).max(10) }),
  z.object({ type: z.literal('setDeck'), deckId: z.string().max(40), custom: z.array(z.string().trim().min(1).max(10)).max(20).optional() }),
  z.object({ type: z.literal('setObserver'), observer: z.boolean() }),
  z.object({ type: z.literal('setAutoReveal'), autoReveal: z.boolean() }),
]);
export type PokerCommand = z.infer<typeof pokerCommand>;

const esvpIds = ESVP.map((e) => e.id) as [string, ...string[]];

export const retroCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('checkin'), word: text(60), esvp: z.enum(esvpIds).nullable().optional() }),
  z.object({ type: z.literal('setCheckinQuestion'), question: required(LIMITS.shortText) }),
  z.object({ type: z.literal('addCard'), columnId: z.string().max(40), text: required(LIMITS.cardText) }),
  z.object({ type: z.literal('editCard'), cardId: id, text: required(LIMITS.cardText) }),
  z.object({ type: z.literal('deleteCard'), cardId: id }),
  z.object({ type: z.literal('group'), cardId: id, intoCardId: id }),
  z.object({ type: z.literal('ungroup'), cardId: id }),
  z.object({ type: z.literal('renameGroup'), groupId: id, title: required(LIMITS.title) }),
  z.object({ type: z.literal('vote'), topicId: id, delta: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ type: z.literal('selectTopic'), topicId: id.nullable() }),
  z.object({ type: z.literal('note'), topicId: id, text: text(LIMITS.longText) }),
  z.object({ type: z.literal('roti'), score: z.number().int().min(1).max(5) }),
  z.object({ type: z.literal('setVotesPerPerson'), votes: z.number().int().min(1).max(20) }),
]);
export type RetroCommand = z.infer<typeof retroCommand>;

export const dailyCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setUpdate'), yesterday: text(LIMITS.shortText), today: text(LIMITS.shortText), blockers: text(LIMITS.shortText) }),
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('prev') }),
  z.object({ type: z.literal('setSpeaker'), index: z.number().int().min(0).max(200) }),
  z.object({ type: z.literal('shuffle') }),
  z.object({ type: z.literal('setPerPerson'), seconds: z.number().int().min(15).max(600) }),
  z.object({ type: z.literal('addParking'), text: required(LIMITS.shortText) }),
  z.object({ type: z.literal('removeParking'), itemId: id }),
]);
export type DailyCommand = z.infer<typeof dailyCommand>;

export const planningCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setCapacity'),
    row: z.object({
      userId: id,
      daysAvailable: z.number().min(0).max(60),
      hoursPerDay: z.number().min(0).max(24),
      focusPercent: z.number().min(0).max(100),
    }),
  }),
  z.object({ type: z.literal('setNotes'), notes: text(LIMITS.longText) }),
]);
export type PlanningCommand = z.infer<typeof planningCommand>;

export const reviewCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setDemoed'), storyId: id, demoed: z.boolean() }),
  z.object({ type: z.literal('addFeedback'), text: required(LIMITS.shortText), from: text(LIMITS.displayName).default(''), storyId: id.nullable().default(null) }),
  z.object({ type: z.literal('removeFeedback'), feedbackId: id }),
  z.object({ type: z.literal('markFeedbackAdded'), feedbackId: id, storyId: id }),
  z.object({ type: z.literal('setNotes'), notes: text(LIMITS.longText) }),
]);
export type ReviewCommand = z.infer<typeof reviewCommand>;

export const pairingCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setParticipants'), participants: z.array(id).min(1).max(20) }),
  z.object({ type: z.literal('setMode'), mode: z.enum(['driver-navigator', 'strong-style', 'ping-pong', 'mob']) }),
  z.object({ type: z.literal('setInterval'), seconds: z.number().int().min(30).max(3600) }),
  z.object({ type: z.literal('rotate') }),
  z.object({ type: z.literal('setAutoRotate'), autoRotate: z.boolean() }),
  z.object({ type: z.literal('startRotation') }),
]);
export type PairingCommand = z.infer<typeof pairingCommand>;
