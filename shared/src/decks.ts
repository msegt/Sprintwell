export interface Deck {
  id: string;
  name: string;
  cards: string[];
  /** Short note shown when choosing the deck. */
  note?: string;
}

export const COFFEE = '☕';
export const UNSURE = '?';

export const DECKS: Deck[] = [
  {
    id: 'fibonacci',
    name: 'Fibonacci',
    cards: ['0', '1', '2', '3', '5', '8', '13', '21', UNSURE, COFFEE],
  },
  {
    id: 'modified-fibonacci',
    name: 'Modified Fibonacci',
    cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', UNSURE, COFFEE],
  },
  {
    id: 'weights',
    name: 'Story weights (1–13)',
    cards: ['1', '2', '3', '5', '8', '13', UNSURE, COFFEE],
    note: 'Matches GitLab issue weights. 8 usually means "split it"; 13 is an epic.',
  },
  {
    id: 'tshirt',
    name: 'T-shirt sizes',
    cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', UNSURE, COFFEE],
  },
  {
    id: 'powers',
    name: 'Powers of two',
    cards: ['0', '1', '2', '4', '8', '16', '32', '64', UNSURE, COFFEE],
  },
];

export function getDeck(id: string, custom?: string[]): Deck {
  if (id === 'custom' && custom && custom.length > 0) {
    return { id: 'custom', name: 'Custom', cards: custom };
  }
  return DECKS.find((d) => d.id === id) ?? DECKS[0]!;
}

/** Converts a card to a number when it has a numeric meaning. */
export function cardToNumber(card: string): number | null {
  if (card === '½') return 0.5;
  if (/^\d+(\.\d+)?$/.test(card)) return Number(card);
  return null;
}

/** Cards that are not estimates (abstentions / requests for a break). */
export function isMetaCard(card: string): boolean {
  return card === UNSURE || card === COFFEE;
}
