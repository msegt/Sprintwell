import { describe, expect, it } from 'vitest';
import { estimateFromIssue, estimateLabels, parseIssueDescription } from '../src';

describe('parseIssueDescription', () => {
  it('reads the story sentence and the acceptance criteria list', () => {
    const p = parseIssueDescription(
      'As a visiting astronomer, I want to book a telescope slot so that I can observe at night.\n\n## Acceptance criteria\n\n- [ ] Given a free slot, when I book it, then it is mine\n- [x] Given a booked slot, when I cancel, then it is free\n\nTechnical notes here.',
    );
    expect(p).toEqual({
      asA: 'visiting astronomer',
      iWant: 'to book a telescope slot',
      soThat: 'I can observe at night',
      acceptanceCriteria: ['Given a free slot, when I book it, then it is mine', 'Given a booked slot, when I cancel, then it is free'],
      notes: 'Technical notes here.',
    });
  });

  it('copes with bold markers, numbered lists and no story', () => {
    const p = parseIssueDescription('**Acceptance criteria**\n1. It loads\n2) It saves');
    expect(p.asA).toBe('');
    expect(p.acceptanceCriteria).toEqual(['It loads', 'It saves']);
    expect(p.notes).toBe('');
    expect(parseIssueDescription(null).notes).toBe('');
    expect(parseIssueDescription('Just a bug report').notes).toBe('Just a bug report');
  });
});

describe('estimates', () => {
  it('prefers the weight, then a points label', () => {
    expect(estimateFromIssue(5, ['points::3'])).toBe('5');
    expect(estimateFromIssue(null, ['frontend', 'points::8'])).toBe('8');
    expect(estimateFromIssue(undefined, ['Estimate: M'])).toBe('M');
    expect(estimateFromIssue(null, ['bug'])).toBeNull();
    expect(estimateLabels(['points::3', 'bug', 'SP: 2'])).toEqual(['points::3', 'SP: 2']);
  });
});
