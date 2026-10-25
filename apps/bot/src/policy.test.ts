import { describe, expect, it } from 'vitest';
import type { InboundMessage } from '@squad/core';
import { decide } from './policy';
import type { SkillScore } from './types';

const msg = (o: Partial<InboundMessage> = {}): InboundMessage => ({
  chatId: 'g',
  isGroup: true,
  from: 's_a',
  text: 'x',
  attachments: [],
  mentionsBot: false,
  ts: 0,
  ...o,
});
const sc = (...v: [string, number][]): SkillScore[] =>
  v.map(([skill, score]) => ({ skill, score, ms: 1 }));
const T = 1_000_000;

describe('decide', () => {
  it('group, no mention, below threshold: quiet', () => {
    const d = decide(msg(), sc(['chat', 0.79]), { now: T });
    expect(d).toMatchObject({
      action: 'quiet',
      reason: 'below_threshold',
      best: { skill: 'chat' },
    });
  });
  it('threshold is inclusive at 0.8 and counts as unprompted', () => {
    const d = decide(msg(), sc(['chat', 0.5], ['quiz', 0.8]), { now: T });
    expect(d).toMatchObject({
      action: 'run',
      skill: 'quiz',
      reason: 'confident',
      unprompted: true,
    });
  });
  it('cooldown blocks unprompted for 2 minutes, boundary inclusive of exactly 120s', () => {
    const s = sc(['quiz', 0.9]);
    expect(decide(msg(), s, { now: T, lastUnpromptedAt: T - 119_999 }).reason).toBe('cooldown');
    expect(decide(msg(), s, { now: T, lastUnpromptedAt: T - 120_000 }).action).toBe('run');
  });
  it('mention always runs, even in cooldown, and is not unprompted', () => {
    const d = decide(msg({ mentionsBot: true }), sc(['chat', 0.1]), {
      now: T,
      lastUnpromptedAt: T,
    });
    expect(d).toMatchObject({ action: 'run', reason: 'mentioned', unprompted: false });
  });
  it('DM always runs the top skill', () => {
    const d = decide(msg({ isGroup: false }), sc(['chat', 0], ['a', 0.2]), { now: T });
    expect(d).toMatchObject({ action: 'run', reason: 'dm', skill: 'a', unprompted: false });
  });
  it('ties go to the earliest registered skill', () => {
    expect(decide(msg({ mentionsBot: true }), sc(['a', 0.5], ['b', 0.5]), { now: T }).skill).toBe(
      'a',
    );
  });
  it('clamps NaN, negative and >1 scores', () => {
    const d = decide(msg(), sc(['a', NaN], ['b', -3], ['c', 7]), { now: T });
    expect(d.scores.map((s) => s.score)).toEqual([0, 0, 1]);
    expect(d.skill).toBe('c');
  });
  it('no skills: quiet', () => {
    expect(decide(msg({ mentionsBot: true }), [], { now: T }).reason).toBe('no_skills');
  });
  it('custom config', () => {
    const d = decide(msg(), sc(['a', 0.5]), { now: T }, { threshold: 0.5 });
    expect(d.action).toBe('run');
  });
});
