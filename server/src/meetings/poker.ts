import {
  LIMITS,
  getDeck,
  pokerStats,
  type PokerView,
} from '@sprintwell/shared';
import {
  pokerCommand,
  type PokerCommand,
} from '@sprintwell/shared/schemas';
import { newId } from '../util';
import { MeetingError, md, requirePhase, type Engine, type EngineCtx } from './engine';

interface PokerItem {
  id: string;
  storyId: string | null;
  title: string;
  finalEstimate: string | null;
  round: number;
  revealed: boolean;
  votes: Record<string, string>;
  history: { round: number; votes: Record<string, string> }[];
}

export interface PokerState {
  deckId: string;
  custom?: string[];
  autoReveal: boolean;
  observers: string[];
  items: PokerItem[];
  currentItemId: string | null;
}

function deckOf(state: PokerState): string[] {
  return getDeck(state.deckId, state.custom).cards;
}

function current(state: PokerState): PokerItem {
  const item = state.items.find((i) => i.id === state.currentItemId);
  if (!item) throw new MeetingError('Choose a story to estimate first.');
  return item;
}

/** Everyone online who is not observing is expected to vote. */
function expectedVoters(ctx: EngineCtx<PokerState>): string[] {
  return ctx.online.filter((id) => !ctx.state.observers.includes(id));
}

function maybeAutoReveal(ctx: EngineCtx<PokerState>): boolean {
  const s = ctx.state;
  if (!s.autoReveal || !s.currentItemId) return false;
  const item = s.items.find((i) => i.id === s.currentItemId);
  if (!item || item.revealed || Object.keys(item.votes).length === 0) return false;
  const expected = expectedVoters(ctx);
  if (expected.length > 0 && expected.every((id) => id in item.votes)) {
    item.revealed = true;
    return true;
  }
  return false;
}

async function addItems(ctx: EngineCtx<PokerState>, titles: string[], storyIds: string[]): Promise<void> {
  const s = ctx.state;
  if (s.items.length + titles.length + storyIds.length > LIMITS.itemsPerPoker) {
    throw new MeetingError(`A session can hold up to ${LIMITS.itemsPerPoker} stories.`);
  }
  const already = new Set(s.items.map((i) => i.storyId).filter(Boolean));
  const stories = await ctx.repo.storiesByIds(ctx.meeting.teamId, storyIds.filter((id) => !already.has(id)));
  const fresh: PokerItem[] = [
    ...stories.map((st) => ({ id: newId(), storyId: st.id, title: st.title, finalEstimate: null, round: 1, revealed: false, votes: {}, history: [] })),
    ...titles.map((title) => ({ id: newId(), storyId: null, title, finalEstimate: null, round: 1, revealed: false, votes: {}, history: [] })),
  ];
  s.items.push(...fresh);
  if (!s.currentItemId && fresh[0]) s.currentItemId = fresh[0].id;
}

export const pokerEngine: Engine<PokerState, PokerCommand, PokerView> = {
  kind: 'poker',
  schema: pokerCommand,
  facilitatorOnly: new Set(['removeItem', 'selectItem', 'reveal', 'revote', 'finalise', 'setDeck', 'setAutoReveal']),

  defaultTitle: () => 'Planning Poker',

  async create(input) {
    const deckId = typeof input.options.deckId === 'string' ? input.options.deckId : input.settings.defaultDeck;
    const state: PokerState = {
      deckId: getDeck(deckId).id,
      autoReveal: input.options.autoReveal === true,
      observers: [],
      items: [],
      currentItemId: null,
    };
    const storyIds = Array.isArray(input.options.storyIds) ? input.options.storyIds.filter((x): x is string => typeof x === 'string').slice(0, LIMITS.itemsPerPoker) : [];
    if (storyIds.length) {
      const stories = await input.repo.storiesByIds(input.teamId, storyIds);
      state.items = stories.map((st) => ({ id: newId(), storyId: st.id, title: st.title, finalEstimate: null, round: 1, revealed: false, votes: {}, history: [] }));
      state.currentItemId = state.items[0]?.id ?? null;
    }
    return { state };
  },

  async apply(ctx, cmd) {
    const s = ctx.state;
    if (cmd.type !== 'setObserver' && cmd.type !== 'setAutoReveal' && cmd.type !== 'setDeck') requirePhase(ctx, 'estimate');
    switch (cmd.type) {
      case 'addItems':
        if (cmd.titles.length + cmd.storyIds.length === 0) throw new MeetingError('Nothing to add.');
        await addItems(ctx, cmd.titles, cmd.storyIds);
        break;
      case 'removeItem': {
        s.items = s.items.filter((i) => i.id !== cmd.itemId);
        if (s.currentItemId === cmd.itemId) s.currentItemId = s.items.find((i) => !i.finalEstimate)?.id ?? s.items[0]?.id ?? null;
        break;
      }
      case 'selectItem':
        if (!s.items.some((i) => i.id === cmd.itemId)) throw new MeetingError('That story is not in this session.');
        s.currentItemId = cmd.itemId;
        break;
      case 'vote': {
        const item = current(s);
        if (item.revealed) throw new MeetingError('Votes are already revealed. Ask the facilitator to start a new round.');
        if (s.observers.includes(ctx.actorId)) throw new MeetingError('You are observing. Switch to voting to pick a card.');
        if (cmd.value === null) {
          delete item.votes[ctx.actorId];
        } else {
          if (!deckOf(s).includes(cmd.value)) throw new MeetingError('That card is not in the deck.');
          item.votes[ctx.actorId] = cmd.value;
          maybeAutoReveal(ctx);
        }
        break;
      }
      case 'reveal': {
        const item = current(s);
        if (Object.keys(item.votes).length === 0) throw new MeetingError('Nobody has voted yet.');
        item.revealed = true;
        break;
      }
      case 'revote': {
        const item = current(s);
        if (item.revealed && Object.keys(item.votes).length > 0) {
          item.history.push({ round: item.round, votes: item.votes });
          // Keep the state bounded: the last 10 rounds are plenty for discussion.
          if (item.history.length > 10) item.history = item.history.slice(-10);
        }
        item.votes = {};
        item.revealed = false;
        item.round += 1;
        item.finalEstimate = null;
        break;
      }
      case 'finalise': {
        const item = current(s);
        item.finalEstimate = cmd.value;
        if (item.storyId) {
          await ctx.repo.updateStory(ctx.meeting.teamId, item.storyId, { estimate: cmd.value }).catch(() => {
            // The story may have been deleted; the estimate stays in the session.
          });
          ctx.touchTeam();
        }
        const idx = s.items.indexOf(item);
        const next = [...s.items.slice(idx + 1), ...s.items.slice(0, idx)].find((i) => !i.finalEstimate);
        if (next) s.currentItemId = next.id;
        break;
      }
      case 'setDeck': {
        const deck = getDeck(cmd.deckId, cmd.custom);
        s.deckId = deck.id;
        s.custom = deck.id === 'custom' ? deck.cards : undefined;
        // Votes cast with the old deck may not exist in the new one.
        for (const item of s.items) if (!item.revealed) item.votes = {};
        break;
      }
      case 'setObserver':
        s.observers = s.observers.filter((id) => id !== ctx.actorId);
        if (cmd.observer) {
          s.observers.push(ctx.actorId);
          const item = s.items.find((i) => i.id === s.currentItemId);
          if (item && !item.revealed) delete item.votes[ctx.actorId];
        }
        maybeAutoReveal(ctx);
        break;
      case 'setAutoReveal':
        s.autoReveal = cmd.autoReveal;
        maybeAutoReveal(ctx);
        break;
    }
  },

  onPresence: (ctx) => maybeAutoReveal(ctx),

  view(state, viewerId) {
    const deck = deckOf(state);
    return {
      deckId: state.deckId,
      deck,
      autoReveal: state.autoReveal,
      observers: state.observers,
      currentItemId: state.currentItemId,
      items: state.items.map((i) => ({
        id: i.id,
        storyId: i.storyId,
        title: i.title,
        finalEstimate: i.finalEstimate,
        round: i.round,
        revealed: i.revealed,
        voted: Object.keys(i.votes),
        myVote: i.votes[viewerId] ?? null,
        votes: i.revealed ? i.votes : null,
        stats: i.revealed ? pokerStats(deck, Object.values(i.votes)) : null,
        history: i.history,
      })),
    };
  },

  summary(state, _meeting, names) {
    const deck = deckOf(state);
    const lines = [`Deck: ${getDeck(state.deckId, state.custom).name} (${deck.join(', ')})`, '', '| Story | Estimate | Rounds | Votes (last round) |', '|---|---|---|---|'];
    for (const i of state.items) {
      const votes = i.revealed ? i.votes : (i.history[i.history.length - 1]?.votes ?? {});
      const voteText = Object.entries(votes)
        .map(([u, v]) => `${md(names(u))}: ${md(v)}`)
        .join('; ');
      lines.push(`| ${md(i.title)} | ${i.finalEstimate ? md(i.finalEstimate) : 'not estimated'} | ${i.round} | ${voteText || '–'} |`);
    }
    return lines.join('\n');
  },
};
