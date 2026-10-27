import { describe, expect, it } from 'vitest';
import { INVEST, readinessProblems, type CharterItemDTO } from '../src';

const dor: CharterItemDTO[] = [
  { id: 'd1', kind: 'dor', text: 'Acceptance criteria are defined', position: 0, updatedAt: '', updatedBy: null },
  { id: 'd2', kind: 'dor', text: 'The story is estimated', position: 1, updatedAt: '', updatedBy: null },
];
const allInvest = Object.fromEntries(INVEST.map((i) => [i.key, true]));
const ready = {
  kind: 'story' as const,
  asA: 'student',
  iWant: 'to book a telescope slot',
  soThat: 'I can observe at night',
  acceptanceCriteria: ['Given a free slot, when I book it, then it is mine'],
  invest: allInvest,
  dor: { d1: true, d2: true },
};

describe('readinessProblems', () => {
  it('accepts a complete user story', () => {
    expect(readinessProblems(ready, dor)).toEqual([]);
  });

  it('lists every problem with a user story', () => {
    const codes = readinessProblems({ ...ready, soThat: ' ', acceptanceCriteria: [], invest: { I: true }, dor: { d1: true } }, dor).map((p) => p.code);
    expect(codes).toEqual(['format', 'acceptance', 'invest', 'dor']);
  });

  it('names the missing parts so students know what to fix', () => {
    const [format] = readinessProblems({ ...ready, asA: '', soThat: '' }, dor);
    expect(format!.message).toContain('“As a…”');
    expect(format!.message).toContain('“so that…”');
    expect(format!.message).not.toContain('“I want…”');
  });

  it('only asks bugs, spikes and tasks for the Definition of Ready', () => {
    const bug = { ...ready, kind: 'bug' as const, asA: '', iWant: '', soThat: '', acceptanceCriteria: [], invest: {} };
    expect(readinessProblems(bug, dor)).toEqual([]);
    expect(readinessProblems({ ...bug, dor: {} }, dor).map((p) => p.code)).toEqual(['dor']);
  });

  it('blocks everything while the team has no Definition of Ready', () => {
    expect(readinessProblems(ready, []).map((p) => p.code)).toEqual(['dor-missing']);
  });
});
