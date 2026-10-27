import { describe, expect, it } from 'vitest';
import { pokerStats, shouldSplit, getDeck, DECKS } from '../src';

const fib = getDeck('fibonacci').cards;

describe('pokerStats', () => {
  it('detects consensus and suggests the agreed card', () => {
    const s = pokerStats(fib, ['5', '5', '5']);
    expect(s.consensus).toBe(true);
    expect(s.suggestion).toBe('5');
    expect(s.explainers).toBeNull();
  });

  it('finds the outliers who should explain first', () => {
    const s = pokerStats(fib, ['3', '5', '13', '5']);
    expect(s.consensus).toBe(false);
    expect(s.min).toBe('3');
    expect(s.max).toBe('13');
    expect(s.explainers).toEqual({ low: '3', high: '13' });
    expect(s.mode).toEqual(['5']);
    expect(s.median).toBe(5);
    expect(s.mean).toBe(6.5);
    expect(s.suggestion).toBe('5');
  });

  it('ignores ? and coffee in the estimate but counts them', () => {
    const s = pokerStats(fib, ['8', '?', '☕', '8']);
    expect(s.voters).toBe(4);
    expect(s.estimates).toBe(2);
    expect(s.unsure).toBe(1);
    expect(s.breakRequests).toBe(1);
    expect(s.consensus).toBe(true);
  });

  it('works with ordinal decks such as T-shirt sizes', () => {
    const deck = getDeck('tshirt').cards;
    const s = pokerStats(deck, ['S', 'L', 'M']);
    expect(s.mean).toBeNull();
    expect(s.min).toBe('S');
    expect(s.max).toBe('L');
    expect(s.suggestion).toBe('M');
  });

  it('rounds the median to the nearest card, preferring the larger on ties', () => {
    const s = pokerStats(fib, ['2', '3']); // median 2.5 -> 3
    expect(s.suggestion).toBe('3');
  });

  it('handles the half card', () => {
    const deck = getDeck('modified-fibonacci').cards;
    const s = pokerStats(deck, ['½', '1']);
    expect(s.min).toBe('½');
    expect(s.mean).toBe(0.75);
  });

  it('returns an empty summary when nobody estimated', () => {
    const s = pokerStats(fib, ['?']);
    expect(s.estimates).toBe(0);
    expect(s.suggestion).toBeNull();
    expect(s.consensus).toBe(false);
  });
});

describe('shouldSplit', () => {
  it('flags large estimates', () => {
    expect(shouldSplit('8', 8)).toBe(true);
    expect(shouldSplit('5', 8)).toBe(false);
    expect(shouldSplit('XL', 8)).toBe(true);
    expect(shouldSplit(null, 8)).toBe(false);
  });
});

describe('decks', () => {
  it('have unique ids and cards', () => {
    expect(new Set(DECKS.map((d) => d.id)).size).toBe(DECKS.length);
    for (const d of DECKS) expect(new Set(d.cards).size).toBe(d.cards.length);
  });
});
