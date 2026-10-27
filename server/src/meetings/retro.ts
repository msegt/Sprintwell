import {
  CHECKIN_QUESTIONS,
  ESVP,
  LIMITS,
  RETRO_TEMPLATES,
  getTemplate,
  type EsvpId,
  type RetroColumn,
  type RetroView,
} from '@sprintwell/shared';
import {
  retroCommand,
  type RetroCommand,
} from '@sprintwell/shared/schemas';
import { newId } from '../util';
import { MeetingError, md, requirePhase, type Engine } from './engine';

interface Card {
  id: string;
  columnId: string;
  text: string;
  authorId: string;
  groupId: string | null;
  createdAt: string;
}

export interface RetroState {
  templateId: string;
  columns: RetroColumn[];
  anonymous: boolean;
  votesPerPerson: number;
  checkinQuestion: string;
  checkins: Record<string, { word: string; esvp: EsvpId | null }>;
  cards: Card[];
  groups: { id: string; columnId: string; title: string }[];
  votes: Record<string, Record<string, number>>;
  currentTopicId: string | null;
  notes: Record<string, string>;
  roti: Record<string, number>;
}

/** A topic is either a group of cards or a card that is not in a group. */
export function topicIds(s: RetroState): string[] {
  return [...s.groups.map((g) => g.id), ...s.cards.filter((c) => !c.groupId).map((c) => c.id)];
}

function pruneVotes(s: RetroState): void {
  const valid = new Set(topicIds(s));
  for (const userVotes of Object.values(s.votes)) {
    for (const t of Object.keys(userVotes)) if (!valid.has(t)) delete userVotes[t];
  }
}

/** Dissolves groups with fewer than two cards. */
function tidyGroups(s: RetroState): void {
  for (const g of [...s.groups]) {
    const members = s.cards.filter((c) => c.groupId === g.id);
    if (members.length < 2) {
      for (const c of members) c.groupId = null;
      s.groups = s.groups.filter((x) => x.id !== g.id);
    }
  }
  pruneVotes(s);
}

function totals(s: RetroState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of topicIds(s)) out[t] = 0;
  for (const userVotes of Object.values(s.votes)) {
    for (const [t, n] of Object.entries(userVotes)) if (t in out) out[t]! += n;
  }
  return out;
}

function sanitiseColumns(input: unknown): RetroColumn[] | null {
  if (!Array.isArray(input)) return null;
  const tones = ['green', 'red', 'blue', 'amber', 'purple', 'teal', 'grey'] as const;
  const cols = input
    .slice(0, 6)
    .map((c, i) => {
      const title = typeof c?.title === 'string' ? c.title.trim().slice(0, 40) : '';
      const prompt = typeof c?.prompt === 'string' ? c.prompt.trim().slice(0, 200) : '';
      return title ? { id: `c${i + 1}`, title, prompt, tone: tones[i % tones.length]! } : null;
    })
    .filter((c): c is RetroColumn => c !== null);
  return cols.length > 0 ? cols : null;
}

export const retroEngine: Engine<RetroState, RetroCommand, RetroView> = {
  kind: 'retro',
  schema: retroCommand,
  facilitatorOnly: new Set(['selectTopic', 'setCheckinQuestion', 'setVotesPerPerson']),

  defaultTitle(input) {
    const t = getTemplate(String(input.options.templateId ?? '')) ?? RETRO_TEMPLATES[0]!;
    return `Retrospective: ${t.name}`;
  },

  create(input) {
    const custom = input.options.templateId === 'custom' ? sanitiseColumns(input.options.columns) : null;
    const template = getTemplate(String(input.options.templateId ?? '')) ?? RETRO_TEMPLATES[0]!;
    const question = typeof input.options.checkinQuestion === 'string' && input.options.checkinQuestion.trim() ? input.options.checkinQuestion.trim().slice(0, LIMITS.shortText) : CHECKIN_QUESTIONS[0]!;
    return {
      state: {
        templateId: custom ? 'custom' : template.id,
        columns: custom ?? template.columns,
        anonymous: input.options.anonymous !== false,
        votesPerPerson: input.settings.retroVotesPerPerson,
        checkinQuestion: question,
        checkins: {},
        cards: [],
        groups: [],
        votes: {},
        currentTopicId: null,
        notes: {},
        roti: {},
      },
    };
  },

  apply(ctx, cmd) {
    const s = ctx.state;
    switch (cmd.type) {
      case 'checkin':
        requirePhase(ctx, 'checkin');
        s.checkins[ctx.actorId] = { word: cmd.word, esvp: (cmd.esvp as EsvpId | null | undefined) ?? s.checkins[ctx.actorId]?.esvp ?? null };
        break;
      case 'setCheckinQuestion':
        s.checkinQuestion = cmd.question;
        break;
      case 'addCard': {
        requirePhase(ctx, 'reflect', 'group');
        if (!s.columns.some((c) => c.id === cmd.columnId)) throw new MeetingError('Unknown column.');
        if (s.cards.length >= LIMITS.cardsPerMeeting) throw new MeetingError('This retrospective has reached its card limit.');
        s.cards.push({ id: newId(), columnId: cmd.columnId, text: cmd.text, authorId: ctx.actorId, groupId: null, createdAt: new Date().toISOString() });
        break;
      }
      case 'editCard': {
        requirePhase(ctx, 'reflect', 'group');
        const card = s.cards.find((c) => c.id === cmd.cardId);
        if (!card) throw new MeetingError('Card not found.');
        if (card.authorId !== ctx.actorId) throw new MeetingError('You can only edit your own cards.');
        card.text = cmd.text;
        break;
      }
      case 'deleteCard': {
        requirePhase(ctx, 'reflect', 'group');
        const card = s.cards.find((c) => c.id === cmd.cardId);
        if (!card) throw new MeetingError('Card not found.');
        if (card.authorId !== ctx.actorId && !ctx.isFacilitator) throw new MeetingError('You can only delete your own cards.');
        s.cards = s.cards.filter((c) => c.id !== cmd.cardId);
        tidyGroups(s);
        break;
      }
      case 'group': {
        requirePhase(ctx, 'group');
        if (cmd.cardId === cmd.intoCardId) throw new MeetingError('Choose a different card.');
        const card = s.cards.find((c) => c.id === cmd.cardId);
        const target = s.cards.find((c) => c.id === cmd.intoCardId);
        if (!card || !target) throw new MeetingError('Card not found.');
        if (target.groupId) {
          card.groupId = target.groupId;
        } else {
          const group = { id: newId(), columnId: target.columnId, title: target.text.slice(0, 80) };
          s.groups.push(group);
          target.groupId = group.id;
          card.groupId = group.id;
        }
        tidyGroups(s);
        break;
      }
      case 'ungroup': {
        requirePhase(ctx, 'group');
        const card = s.cards.find((c) => c.id === cmd.cardId);
        if (!card) throw new MeetingError('Card not found.');
        card.groupId = null;
        tidyGroups(s);
        break;
      }
      case 'renameGroup': {
        requirePhase(ctx, 'group', 'vote', 'discuss');
        const g = s.groups.find((x) => x.id === cmd.groupId);
        if (!g) throw new MeetingError('Group not found.');
        g.title = cmd.title;
        break;
      }
      case 'vote': {
        requirePhase(ctx, 'vote');
        if (!topicIds(s).includes(cmd.topicId)) throw new MeetingError('That topic no longer exists.');
        const mine = (s.votes[ctx.actorId] ??= {});
        const used = Object.values(mine).reduce((a, b) => a + b, 0);
        const currentCount = mine[cmd.topicId] ?? 0;
        if (cmd.delta === 1 && used >= s.votesPerPerson) throw new MeetingError('You have used all your votes. Remove one to vote elsewhere.');
        if (cmd.delta === -1 && currentCount === 0) throw new MeetingError('You have not voted for that topic.');
        const next = currentCount + cmd.delta;
        if (next === 0) delete mine[cmd.topicId];
        else mine[cmd.topicId] = next;
        break;
      }
      case 'setVotesPerPerson':
        s.votesPerPerson = cmd.votes;
        // Trim anyone who now has too many votes, starting with their smallest stacks.
        for (const mine of Object.values(s.votes)) {
          let used = Object.values(mine).reduce((a, b) => a + b, 0);
          for (const t of Object.keys(mine).sort((a, b) => mine[a]! - mine[b]!)) {
            while (used > s.votesPerPerson && mine[t]! > 0) {
              mine[t]! -= 1;
              used -= 1;
            }
            if (mine[t] === 0) delete mine[t];
          }
        }
        break;
      case 'selectTopic':
        requirePhase(ctx, 'discuss');
        if (cmd.topicId !== null && !topicIds(s).includes(cmd.topicId)) throw new MeetingError('That topic no longer exists.');
        s.currentTopicId = cmd.topicId;
        break;
      case 'note':
        requirePhase(ctx, 'discuss');
        if (!topicIds(s).includes(cmd.topicId)) throw new MeetingError('That topic no longer exists.');
        if (cmd.text) s.notes[cmd.topicId] = cmd.text;
        else delete s.notes[cmd.topicId];
        break;
      case 'roti':
        requirePhase(ctx, 'close');
        s.roti[ctx.actorId] = cmd.score;
        break;
    }
  },

  view(s, viewerId, meeting) {
    const phase = meeting.phase;
    const ended = !!meeting.endedAt;
    const hideOthers = phase === 'reflect' && !ended;
    const showTotals = ended || phase === 'discuss' || phase === 'close';
    const hiddenCounts: Record<string, number> = {};
    const cards = s.cards.flatMap((c) => {
      const mine = c.authorId === viewerId;
      if (hideOthers && !mine) {
        hiddenCounts[c.columnId] = (hiddenCounts[c.columnId] ?? 0) + 1;
        return [];
      }
      return [{ id: c.id, columnId: c.columnId, text: c.text, groupId: c.groupId, mine, ...(s.anonymous ? {} : { authorId: c.authorId }) }];
    });
    const mine = s.votes[viewerId] ?? {};
    const used = Object.values(mine).reduce((a, b) => a + b, 0);
    const esvp = Object.fromEntries(ESVP.map((e) => [e.id, 0])) as Record<EsvpId, number>;
    for (const c of Object.values(s.checkins)) if (c.esvp) esvp[c.esvp] += 1;
    const rotiCounts = [0, 0, 0, 0, 0];
    for (const v of Object.values(s.roti)) rotiCounts[v - 1]! += 1;
    return {
      templateId: s.templateId,
      columns: s.columns,
      anonymous: s.anonymous,
      votesPerPerson: s.votesPerPerson,
      checkinQuestion: s.checkinQuestion,
      checkins: Object.entries(s.checkins)
        .filter(([, c]) => c.word)
        .map(([userId, c]) => ({ userId, word: c.word })),
      esvp,
      myEsvp: s.checkins[viewerId]?.esvp ?? null,
      cards,
      hiddenCounts,
      groups: s.groups,
      myVotes: mine,
      votesRemaining: Math.max(0, s.votesPerPerson - used),
      totals: showTotals ? totals(s) : null,
      voterCount: Object.values(s.votes).filter((v) => Object.keys(v).length > 0).length,
      currentTopicId: s.currentTopicId,
      notes: s.notes,
      roti: { counts: rotiCounts, mine: s.roti[viewerId] ?? null, responses: Object.keys(s.roti).length },
    };
  },

  summary(s, _meeting, names) {
    const out: string[] = [];
    out.push(`Format: ${getTemplate(s.templateId)?.name ?? 'Custom'}`);
    if (Object.keys(s.checkins).length) {
      out.push('', `### Check-in: ${md(s.checkinQuestion)}`, '');
      for (const [u, c] of Object.entries(s.checkins)) if (c.word) out.push(`- ${md(names(u))}: ${md(c.word)}`);
    }
    const t = totals(s);
    const title = (topic: string) => s.groups.find((g) => g.id === topic)?.title ?? s.cards.find((c) => c.id === topic)?.text ?? '';
    const ranked = Object.entries(t).sort((a, b) => b[1] - a[1]);
    if (ranked.length) {
      out.push('', '### Topics by votes', '');
      for (const [topic, votes] of ranked) {
        out.push(`- **${md(title(topic))}** (${votes} vote${votes === 1 ? '' : 's'})`);
        const members = s.cards.filter((c) => c.groupId === topic);
        for (const c of members) out.push(`  - ${md(c.text)}`);
        if (s.notes[topic]) out.push(`  - _Notes:_ ${md(s.notes[topic]!)}`);
      }
    }
    for (const col of s.columns) {
      const cards = s.cards.filter((c) => c.columnId === col.id);
      if (!cards.length) continue;
      out.push('', `### ${md(col.title)}`, '');
      for (const c of cards) out.push(`- ${md(c.text)}${s.anonymous ? '' : ` (${md(names(c.authorId))})`}`);
    }
    const roti = Object.values(s.roti);
    if (roti.length) {
      const avg = roti.reduce((a, b) => a + b, 0) / roti.length;
      out.push('', `### Return on time invested`, '', `${avg.toFixed(1)} / 5 from ${roti.length} ${roti.length === 1 ? 'person' : 'people'}`);
    }
    return out.join('\n');
  },
};
