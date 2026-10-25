import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { VillageEventSchema, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import {
  createMasteryStore,
  intervalMs,
  nextBox,
  masterySummary,
  squadAggregate,
  isDue,
} from './index';

const mk = () => {
  const events: VillageEvent[] = [];
  const store = createMasteryStore({
    db: openMemoryDb(),
    emit: (e) => void events.push(e),
    now: () => 1000,
  });
  return { store, events };
};

describe('leitner', () => {
  it('box stays in 1..5 and moves per rule', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 40 }), (seq) => {
        let box = 1;
        for (const c of seq) {
          const n = nextBox(box, c);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(5);
          expect(n).toBe(c ? Math.min(5, box + 1) : 1);
          box = n;
        }
      }),
    );
  });
  it('interval is non-decreasing in box', () => {
    for (let b = 1; b < 5; b++) expect(intervalMs(b + 1)).toBeGreaterThanOrEqual(intervalMs(b));
  });
});

describe('store', () => {
  it('emits mastery.changed exactly when the box changes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { maxLength: 25 }), async (seq) => {
        const { store, events } = mk();
        let box = 1;
        let moves = 0;
        for (const c of seq) {
          const n = nextBox(box, c);
          if (n !== box) moves++;
          const r = await store.record('s_a', 'c1', 'ch3', c);
          expect(r.box).toBe(n);
          expect(r.moved).toBe(n !== box);
          expect(r.nextDue).toBeGreaterThanOrEqual(1000);
          box = n;
        }
        expect(events).toHaveLength(moves);
        for (const e of events) {
          expect(VillageEventSchema.safeParse(e).success).toBe(true);
          expect(e).toMatchObject({ t: 'mastery.changed', student: 's_a', chapter: 'ch3' });
        }
        if (events.length) expect((events.at(-1) as { box: number }).box).toBe(box);
      }),
    );
  });
  it('queueReview drops to box 1 and is due now; emit failure never breaks the write', async () => {
    const store = createMasteryStore({
      db: openMemoryDb(),
      emit: () => {
        throw new Error('hub down');
      },
      now: () => 5,
    });
    await store.record('s_a', 'c1', 'ch1', true);
    expect(store.get('s_a', 'c1', 'ch1').box).toBe(2);
    const r = await store.queueReview('s_a', 'c1', 'ch1');
    expect(r).toMatchObject({ box: 1, nextDue: 5, moved: true });
    expect(isDue(r, 5)).toBe(true);
    expect(store.forStudent('s_a', 'c1')).toHaveLength(1);
  });
});

describe('summary', () => {
  it('weakest ordering is deterministic and own-data only', () => {
    const rows = [
      { student: 's', courseId: 'c', chapter: 'b', box: 3, nextDue: 10 },
      { student: 's', courseId: 'c', chapter: 'a', box: 1, nextDue: 10 },
      { student: 's', courseId: 'c', chapter: 'c', box: 1, nextDue: 5 },
    ];
    expect(masterySummary(rows, 7).weakest).toEqual(['c', 'a']);
    expect(masterySummary(rows, 7).overdue).toEqual(['c']);
    expect(masterySummary([], 0).nextStep).toMatch(/quiz/i);
  });
  it('hides aggregates under 3', () => {
    expect(squadAggregate([], 2)).toBeNull();
    expect(squadAggregate([], 3)).toEqual({ chapters: 0 });
  });
});
