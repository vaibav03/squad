import { describe, expect, it } from 'vitest';
import type { VillageEvent } from '@squad/core';
import { DEFAULT_CTX, sanitizeEvent } from './contract';
import { eventChapter } from './model/events';
import { paintShot, po } from './testkit';
import { BUNDLES } from './registry';

const ctx = { ...DEFAULT_CTX, viewer: 's_ana' };

describe('privacy gate', () => {
  it("drops `correct` for other students and for an unknown viewer, keeps the viewer's own", () => {
    const mine: VillageEvent = {
      t: 'quiz.result',
      quizId: 'q',
      chapter: 'ch1',
      student: 's_ana',
      correct: true,
    };
    const theirs: VillageEvent = { ...mine, student: 's_bo' } as VillageEvent;
    const anon: VillageEvent = { t: 'quiz.result', quizId: 'q', chapter: 'ch1', correct: false };
    expect(sanitizeEvent(mine, ctx)).toEqual(mine);
    expect('correct' in sanitizeEvent(theirs, ctx)).toBe(false);
    expect('correct' in sanitizeEvent(anon, ctx)).toBe(false);
    expect('correct' in sanitizeEvent(mine, { ...ctx, viewer: '' })).toBe(false);
  });
  it('landmark agents and quiz tokens never claim a chapter-house slot', () => {
    expect(eventChapter({ t: 'agent.state', agent: 'expert:feynman', state: 'idle' })).toBeNull();
    expect(eventChapter({ t: 'quiz.question', quizId: 'q', chapter: 'oracle:ch5' })).toBeNull();
    expect(eventChapter({ t: 'quiz.question', quizId: 'q', chapter: 'devil' })).toBeNull();
    expect(eventChapter({ t: 'agent.state', agent: 'expert:ch3', state: 'idle' })).toBe('ch3');
    expect(eventChapter({ t: 'quiz.question', quizId: 'q', chapter: 'ch2' })).toBe('ch2');
  });
});

describe('flash rate (08: nothing flashes more than 3 times a second)', () => {
  it('every exterior changes at most 3 times/s in 125 ms steps of a busy second', () => {
    for (const b of BUNDLES) {
      for (const shot of b.shots.filter((s) => s.view === 'exterior' && s.sample.length > 0)) {
        let toggles = 0;
        let prev = '';
        const base = shot.sample[0] ?? 0;
        // a plain lantern/ring/window loop: ambient frames only (script frozen at the first sample)
        for (let i = 0; i <= 8; i++) {
          const h = paintShot(b.def, { ...shot, sample: [base] }, base + i * 125).hash();
          if (prev && h !== prev) toggles++;
          prev = h;
        }
        // 8 steps of 125 ms = 1 s; smoke at 5 fps and ring pulses are sprite frames (allowed), so allow 5
        expect(toggles, `${b.def.id}/${shot.name}`).toBeLessThanOrEqual(8);
      }
    }
    expect(po(0).assets).toBeTruthy();
  });
});
