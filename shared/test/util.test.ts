import { describe, expect, it } from 'vitest';
import { burndown, capacityHours, storySentence, riskBand, riskScore, averageVelocity } from '../src';
import type { SprintDTO, StoryDTO } from '../src';

const sprint = (over: Partial<SprintDTO> = {}): SprintDTO => ({
  id: 's1', name: 'Sprint 1', goal: '', startDate: '2026-11-02', endDate: '2026-11-06', status: 'active',
  goalMet: null, capacity: [], createdAt: '', closedAt: null, ...over,
});
const story = (over: Partial<StoryDTO> = {}): StoryDTO => ({
  id: Math.random().toString(36).slice(2), sprintId: 's1', kind: 'story', title: 't', asA: '', iWant: '', soThat: '', acceptanceCriteria: [], notes: '',
  estimate: '3', status: 'todo', invest: {}, dor: {}, externalUrl: '', tasks: [], ownerId: null, position: 0,
  createdAt: '', updatedAt: '', doneAt: null, ...over,
});

describe('capacityHours', () => {
  it('matches the module capacity exercise', () => {
    // 4 people, 10 days, 6 h/day; one has 2 days off; one is new at 70 %.
    const rows = [
      { userId: 'a', daysAvailable: 10, hoursPerDay: 6, focusPercent: 100 },
      { userId: 'b', daysAvailable: 8, hoursPerDay: 6, focusPercent: 100 },
      { userId: 'c', daysAvailable: 10, hoursPerDay: 6, focusPercent: 70 },
      { userId: 'd', daysAvailable: 10, hoursPerDay: 6, focusPercent: 100 },
    ];
    expect(capacityHours(rows)).toBe(60 + 48 + 42 + 60);
  });
});

describe('burndown', () => {
  it('produces ideal and actual lines', () => {
    const stories = [story({ estimate: '5', status: 'done', doneAt: '2026-11-03T10:00:00Z' }), story({ estimate: '5' })];
    const data = burndown(sprint(), stories, new Date('2026-11-04T12:00:00Z'));
    expect(data).toHaveLength(5);
    expect(data[0]).toEqual({ date: '2026-11-02', ideal: 10, remaining: 10 });
    expect(data[1]!.remaining).toBe(5);
    expect(data[4]!.ideal).toBe(0);
    expect(data[4]!.remaining).toBeNull();
  });
  it('returns nothing without dates', () => {
    expect(burndown(sprint({ startDate: null }), [])).toEqual([]);
  });
});

describe('averageVelocity', () => {
  it('averages done points of closed sprints', () => {
    const sprints = [sprint({ id: 'a', status: 'closed', closedAt: '2026-01-01' }), sprint({ id: 'b', status: 'closed', closedAt: '2026-02-01' })];
    const stories = [story({ sprintId: 'a', status: 'done', estimate: '8' }), story({ sprintId: 'b', status: 'done', estimate: '4' }), story({ sprintId: 'b', status: 'todo', estimate: '13' })];
    expect(averageVelocity(sprints, stories)).toBe(6);
    expect(averageVelocity([], [])).toBeNull();
  });
});

describe('storySentence', () => {
  it('adds the right article', () => {
    expect(storySentence({ asA: 'student', iWant: 'to see my grades', soThat: 'I can track progress' }))
      .toBe('As a student, I want to see my grades, so that I can track progress.');
    expect(storySentence({ asA: 'admin', iWant: 'x', soThat: '' })).toBe('As an admin, I want x.');
  });
});

describe('risk', () => {
  it('bands scores', () => {
    expect(riskBand(riskScore(3, 3))).toBe('high');
    expect(riskBand(riskScore(2, 2))).toBe('medium');
    expect(riskBand(riskScore(1, 2))).toBe('low');
  });
});
