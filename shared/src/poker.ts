import { cardToNumber, isMetaCard } from './decks';

export interface PokerStats {
  /** Number of people who voted (including ? and ☕). */
  voters: number;
  /** Votes that are estimates (not ? or ☕). */
  estimates: number;
  unsure: number;
  breakRequests: number;
  consensus: boolean;
  /** Most common estimate(s). */
  mode: string[];
  min: string | null;
  max: string | null;
  mean: number | null;
  median: number | null;
  /** Deck card suggested as a starting point for the final estimate. */
  suggestion: string | null;
  /** Distribution of every card, in deck order. */
  distribution: { card: string; count: number }[];
  /**
   * In Planning Poker the people with the lowest and highest estimates explain
   * their reasoning first. These are the cards they chose (null on consensus).
   */
  explainers: { low: string; high: string } | null;
}

/**
 * Summarises a revealed round. `deck` gives the ordering, so the function also
 * works for non-numeric decks such as T-shirt sizes.
 */
export function pokerStats(deck: string[], votes: string[]): PokerStats {
  const order = new Map(deck.map((c, i) => [c, i]));
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);

  const estimates = votes.filter((v) => !isMetaCard(v));
  const sorted = [...estimates].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  let mode: string[] = [];
  let best = 0;
  for (const card of new Set(estimates)) {
    const c = counts.get(card) ?? 0;
    if (c > best) {
      best = c;
      mode = [card];
    } else if (c === best) {
      mode.push(card);
    }
  }
  mode.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  const numbers = estimates.map(cardToNumber).filter((n): n is number => n !== null);
  const allNumeric = numbers.length === estimates.length && numbers.length > 0;
  const mean = allNumeric ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null;
  const median = allNumeric ? medianOf(numbers) : null;

  let suggestion: string | null = null;
  if (allNumeric && median !== null) {
    // Nearest deck card to the median; ties go to the larger card (estimates tend to be optimistic).
    let bestDiff = Infinity;
    for (const card of deck) {
      const n = cardToNumber(card);
      if (n === null) continue;
      const diff = Math.abs(n - median);
      if (diff < bestDiff || (diff === bestDiff && suggestion !== null && n > (cardToNumber(suggestion) ?? 0))) {
        bestDiff = diff;
        suggestion = card;
      }
    }
  } else if (sorted.length > 0) {
    // Ordinal decks (T-shirt): the middle card by deck order.
    suggestion = sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
  }

  const consensus = estimates.length > 0 && new Set(estimates).size === 1;
  const min = sorted[0] ?? null;
  const max = sorted[sorted.length - 1] ?? null;

  const distribution = deck
    .filter((c) => counts.has(c))
    .map((card) => ({ card, count: counts.get(card) ?? 0 }));
  // Cards not in the deck (deck changed mid-round) still count.
  for (const [card, count] of counts) if (!order.has(card)) distribution.push({ card, count });

  return {
    voters: votes.length,
    estimates: estimates.length,
    unsure: counts.get('?') ?? 0,
    breakRequests: counts.get('☕') ?? 0,
    consensus,
    mode,
    min,
    max,
    mean: mean === null ? null : Math.round(mean * 100) / 100,
    median,
    suggestion: consensus ? (estimates[0] ?? null) : suggestion,
    distribution,
    explainers: !consensus && min !== null && max !== null && min !== max ? { low: min, high: max } : null,
  };
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Returns true when an estimate suggests the story should be split. */
export function shouldSplit(estimate: string | null | undefined, threshold: number): boolean {
  if (!estimate) return false;
  const n = cardToNumber(estimate);
  if (n !== null) return n >= threshold;
  return estimate === 'XL' || estimate === 'XXL';
}
