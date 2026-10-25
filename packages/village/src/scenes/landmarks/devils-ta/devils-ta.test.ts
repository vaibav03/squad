import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX } from '../../contract';
import { po, runScript } from '../../testkit';
import { landmarkSuite } from '../lb-suite';
import { devilsTa as def, devilsTaBundle } from './index';

const ctx = DEFAULT_CTX;
const result = (correct?: boolean, chapter = 'devil', quizId = 'devil:w1'): VillageEvent => ({
  t: 'quiz.result',
  student: 's_ana',
  quizId,
  chapter,
  ...(correct === undefined ? {} : { correct }),
});

landmarkSuite("devil's ta", def, devilsTaBundle, 'expert:devil', 'Spot my mistake?', [
  { t: 'quiz.result', student: 's_ana', quizId: 'q1', chapter: 'ch5', correct: false },
  { t: 'quiz.question', quizId: 'devil:1', chapter: 'devil' },
]);

describe("devil's TA quiz.result chalk", () => {
  it('cross on false, tick on true, none on undefined; unlocks first', () => {
    expect(def.mapEvent(result(false), def.init(), ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'chalk', text: '', mark: 'cross' },
    ]);
    const s = { ...def.init(), access: 'open' as const };
    expect(def.mapEvent(result(true), s, ctx)).toEqual([{ c: 'chalk', text: '', mark: 'tick' }]);
    expect(def.mapEvent(result(), s, ctx)).toEqual([{ c: 'chalk', text: '', mark: 'none' }]);
  });
  it('matches devil / devils-ta namespaces only', () => {
    const s = def.init();
    expect(def.handles(result(true, 'devils-ta', 'x'), s, ctx)).toBe(true);
    expect(def.handles(result(true, 'ch1', 'devil-3'), s, ctx)).toBe(true);
    expect(def.handles(result(true, 'ch1', 'devilish'), s, ctx)).toBe(false);
  });
  it('the red underline grows then holds; calm shows it whole at once', () => {
    const s = runScript(def, [{ at: 0, event: result(false) }]);
    const none = runScript(def, [{ at: 0, event: result() }]);
    const h = (st: typeof s, t: number, calm = false) =>
      def.paint(st, 'interior', po(t, calm)).hash();
    expect(h(s, 1000)).not.toBe(h(none, 1000));
    expect(h(s, 60)).not.toBe(h(s, 1000));
    expect(h(s, 20, true)).toBe(h(s, 1000, true));
    expect(def.describe(s)).toMatch(/red underline/);
    const tick = runScript(def, [{ at: 0, event: result(true) }]);
    expect(h(tick, 1000)).not.toBe(h(s, 1000));
  });
});
