import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX } from '../../contract';
import { po, runScript } from '../../testkit';
import { landmarkSuite } from '../lb-suite';
import { examOracle as def, examOracleBundle } from './index';

const ctx = DEFAULT_CTX;
const q = (chapter: string, quizId = 'oracle:next'): VillageEvent => ({
  t: 'quiz.question',
  quizId,
  chapter,
});

landmarkSuite('exam oracle', def, examOracleBundle, 'expert:oracle', 'The stars await.', [
  { t: 'quiz.question', quizId: 'q1', chapter: 'ch5' },
  { t: 'quiz.result', quizId: 'oracle:1', chapter: 'oracle', correct: true },
]);

describe('exam oracle quiz.question label', () => {
  it('unlocks, then chalks "<chapter> next?" from the event chapter', () => {
    expect(def.mapEvent(q('ch5'), def.init(), ctx)).toEqual([
      { c: 'setAccess', access: 'open' },
      { c: 'chalk', text: 'ch5 next?', mark: 'none', question: '' },
    ]);
    const s = { ...def.init(), access: 'open' as const };
    expect(def.mapEvent(q('chapter-12'), s, ctx)).toEqual([
      { c: 'chalk', text: 'ch12 next?', mark: 'none', question: '' },
    ]);
    expect(def.mapEvent(q('thermo dynamics!'), s, ctx)).toEqual([
      { c: 'chalk', text: 'thermo d next?', mark: 'none', question: '' },
    ]);
  });
  it('strips the oracle namespace from the chalk label', () => {
    const s = { ...def.init(), access: 'open' as const };
    expect(def.mapEvent(q('oracle:ch5'), s, ctx)).toEqual([
      { c: 'chalk', text: 'ch5 next?', mark: 'none', question: '' },
    ]);
  });
  it('handles council:oracle opinion and verdict (outcome card), nothing else', () => {
    const s = def.init();
    const outcome = { title: 'Study next: ch5', items: [], facts: [], why: [] };
    const v = {
      t: 'council.verdict',
      councilId: 'council:oracle',
      member: 'oracle',
      text: 'ch5 first',
      outcome,
    } as VillageEvent;
    expect(def.handles(v, s, ctx)).toBe(true);
    expect(def.mapEvent(v, s, ctx)).toContainEqual({ c: 'outcome', outcome });
    const o = {
      t: 'council.opinion',
      councilId: 'council:oracle',
      member: 'oracle',
      text: 'why',
    } as VillageEvent;
    expect(def.handles(o, s, ctx)).toBe(true);
    const other = { ...o, councilId: 'council:planner' } as VillageEvent;
    expect(def.handles(other, s, ctx)).toBe(false);
  });
  it('is handled only for oracle-namespaced questions', () => {
    const s = def.init();
    expect(def.handles(q('oracle', 'x'), s, ctx)).toBe(true);
    expect(def.handles(q('ch5', 'oracle-7'), s, ctx)).toBe(true);
    expect(def.handles(q('ch5', 'quiz-7'), s, ctx)).toBe(false);
  });
  it('the label shows in the painting and in describe, and the orb pulses unless calm', () => {
    const s = runScript(def, [{ at: 0, event: q('ch5') }]);
    const none = { ...s, chalk: { ...s.chalk, text: '' } };
    expect(def.paint(s, 'interior', po(0, false)).hash()).not.toBe(
      def.paint(none, 'interior', po(0, false)).hash(),
    );
    expect(def.describe(s)).toContain('ch5 next?');
    expect(def.paint(s, 'interior', po(0, false)).hash()).not.toBe(
      def.paint(s, 'interior', po(900, false)).hash(),
    );
    expect(def.paint(s, 'interior', po(0, true)).hash()).toBe(
      def.paint(s, 'interior', po(900, true)).hash(),
    );
    expect(def.paint(s, 'exterior', po(0, true)).hash()).toBe(
      def.paint(s, 'exterior', po(2000, true)).hash(),
    );
  });
});
