import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX } from '../../contract';
import { runScript, po } from '../../testkit';
import { landmarkSuite } from '../lb-suite';
import { rubricCourthouse as def, rubricCourthouseBundle } from './index';

const ctx = DEFAULT_CTX;
const result = (
  n: number,
  correct?: boolean,
  over: Partial<{ chapter: string }> = {},
): VillageEvent => ({
  t: 'quiz.result',
  student: 's_ana',
  quizId: `rubric:${n}`,
  chapter: 'rubric',
  ...(correct === undefined ? {} : { correct }),
  ...over,
});

landmarkSuite(
  'rubric courthouse',
  def,
  rubricCourthouseBundle,
  'expert:rubric',
  'Court is waiting.',
  [
    { t: 'quiz.result', student: 's_ana', quizId: 'q1', chapter: 'ch5', correct: true },
    { t: 'quiz.question', quizId: 'rubric:1', chapter: 'rubric' },
  ],
);

describe('rubric courthouse quiz.result rows', () => {
  it('fills rows in order: tick, cross, none, and unlocks first', () => {
    let s = def.init();
    expect(def.mapEvent(result(1, true), s, ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'chalk', text: 'row:0', mark: 'tick' },
    ]);
    s = runScript(def, [{ at: 0, event: result(1, true) }]);
    expect(def.mapEvent(result(2, false), s, ctx)).toEqual([
      { c: 'chalk', text: 'row:1', mark: 'cross' },
    ]);
    s = runScript(def, [
      { at: 0, event: result(1, true) },
      { at: 1, event: result(2, false) },
    ]);
    expect(def.mapEvent(result(3), s, ctx)).toEqual([{ c: 'chalk', text: 'row:2', mark: 'none' }]);
    expect(s.rows).toEqual(['tick', 'cross', 'none']);
  });
  it('a fourth result clears the rubric and starts over', () => {
    const s = runScript(
      def,
      [1, 2, 3].map((n, i) => ({ at: i, event: result(n, true) })),
    );
    expect(def.mapEvent(result(4, false), s, ctx)).toEqual([
      { c: 'chalk', text: 'row:clear', mark: 'none' },
      { c: 'chalk', text: 'row:0', mark: 'cross' },
    ]);
    const s2 = runScript(
      def,
      [1, 2, 3, 4].map((n, i) => ({ at: i, event: result(n, n === 4 ? false : true) })),
    );
    expect(s2.rows).toEqual(['cross', 'none', 'none']);
  });
  it('matches by chapter or quizId namespace only', () => {
    const s = def.init();
    expect(def.handles({ t: 'quiz.result', quizId: 'x', chapter: 'rubric' }, s, ctx)).toBe(true);
    expect(def.handles({ t: 'quiz.result', quizId: 'rubric-2', chapter: 'ch1' }, s, ctx)).toBe(
      true,
    );
    expect(def.handles({ t: 'quiz.result', quizId: 'rubrics', chapter: 'ch1' }, s, ctx)).toBe(
      false,
    );
  });
  it('marks change the painted board (colour only) and never a number', () => {
    const none = runScript(def, [
      { at: 0, event: { t: 'agent.state', agent: 'expert:rubric', state: 'studying' } },
    ]);
    const tick = runScript(def, [{ at: 0, event: result(1, true) }]);
    const cross = runScript(def, [{ at: 0, event: result(1, false) }]);
    const h = (st: typeof none) => def.paint(st, 'interior', po(2000, false)).hash();
    expect(new Set([h(none), h(tick), h(cross)]).size).toBe(3);
    expect(def.describe(tick)).not.toMatch(/\d/);
    expect(def.describe(cross)).not.toMatch(/\d/);
  });
});
