import { describe, expect, it } from 'vitest';
import { PLACEMENTS } from './registry';
import { ROOM_INFO, roomInfo } from './roomInfo';
import { ROOM_SLOTS, type RoomInfo } from './roomTypes';

const strings = (r: RoomInfo): string[] => [
  r.title,
  r.tagline,
  r.purpose,
  r.outcome,
  r.privacy,
  ...r.who.flatMap((w) => [w.name, w.does]),
  ...(r.how.phrase ? [] : []),
  ...r.how.steps,
];

const JARGON = /\b(llm|agent|api|embedding|token)s?\b/i;
const PROMISE = /\b(grades?|scores?|points?|xp|streaks?)\b/gi;
const NEGATED = /\b(never|no|not|without)\s+(\w+\s+)?$/i;

describe('roomInfo', () => {
  it('covers exactly the placed slots', () => {
    expect([...ROOM_SLOTS].sort()).toEqual(PLACEMENTS.map((p) => p.slotId).sort());
    expect(Object.keys(ROOM_INFO).sort()).toEqual([...ROOM_SLOTS].sort());
  });

  for (const slot of ROOM_SLOTS) {
    describe(slot, () => {
      const r = roomInfo(slot)!;
      it('has required copy within limits', () => {
        expect(r.slot).toBe(slot);
        for (const k of ['title', 'tagline', 'purpose', 'outcome', 'privacy'] as const) {
          expect(r[k].trim().length).toBeGreaterThan(0);
          expect(r[k].length).toBeLessThanOrEqual(220);
        }
        expect(r.tagline.split(/\s+/).length).toBeLessThan(10);
        expect(r.who.length).toBeGreaterThanOrEqual(1);
        expect(r.who.length).toBeLessThanOrEqual(5);
        expect(r.how.steps.length).toBeGreaterThanOrEqual(1);
        expect(r.how.steps.length).toBeLessThanOrEqual(4);
        for (const s of strings(r)) {
          expect(s.trim().length).toBeGreaterThan(0);
          expect(s.length).toBeLessThanOrEqual(220);
        }
      });
      it('avoids jargon', () => {
        for (const s of strings(r)) expect(s).not.toMatch(JARGON);
      });
      it('never promises grades or scores', () => {
        for (const s of strings(r)) {
          for (const m of s.matchAll(PROMISE)) {
            expect(NEGATED.test(s.slice(0, m.index)), `"${s}"`).toBe(true);
          }
        }
      });
      it('phrase is a mention or a quoted spoken phrase', () => {
        if (r.how.phrase !== null) {
          expect(/^@squad\b/.test(r.how.phrase) || /^["“].+["”]$/.test(r.how.phrase)).toBe(true);
        }
      });
    });
  }

  it('round table matches the planner skill phrase', () => {
    expect(roomInfo('round-table')!.how.phrase).toBe('@squad plan my next semester');
  });
  it('unknown slot is undefined', () => {
    expect(roomInfo('nope')).toBeUndefined();
  });
});
