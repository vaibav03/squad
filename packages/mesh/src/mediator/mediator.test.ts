import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { VENMO_LINK } from '../protocol';
import { bordaVector, chooseStudySlot, filterOptions, simulate, splitEvenly, tallyBorda, topicCoverage, venmoLink } from './index';

describe('study mediator', () => {
  const slots = ['2026-11-03T16', '2026-11-03T14', '2026-11-04T10'];
  it('lowest cost, tie earliest', () => {
    const r = chooseStudySlot({ commonSlots: slots, costTotals: { '2026-11-03T14': 4, '2026-11-03T16': 2, '2026-11-04T10': 2 }, memberCount: 4 });
    expect(r).toEqual({ kind: 'slot', slot: '2026-11-03T16', costTotal: 2 });
  });
  it('exam cutoff needs lead time', () => {
    const r = chooseStudySlot({ commonSlots: slots, examAt: '2026-11-03T15', memberCount: 4 });
    expect(r.kind === 'slot' && r.slot).toBe('2026-11-03T14');
    const none = chooseStudySlot({ commonSlots: ['2026-11-03T15'], examAt: '2026-11-03T15', memberCount: 4, conflictCounts: { '2026-11-02T09': 1, '2026-11-02T08': 1 } });
    expect(none).toEqual({ kind: 'conflict', reason: 'no_common_slot', hybrid: { slot: '2026-11-02T08' } });
  });
  it('no common slot yields a conflict, hybrid null without data', () => {
    expect(chooseStudySlot({ commonSlots: [], memberCount: 4 })).toEqual({ kind: 'conflict', reason: 'no_common_slot', hybrid: null });
  });
  it('under 3 members: no counts anywhere', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), (n) => {
        const r = chooseStudySlot({ commonSlots: slots, costTotals: { '2026-11-03T14': 3 }, memberCount: n });
        expect(r.kind === 'slot' && r.costTotal).toBe(null);
        expect(topicCoverage({ canTeach: { dp: ['s_ben'] }, weakTotals: { dp: 3 }, memberCount: n })).toEqual([]);
        expect(tallyBorda({ optionIds: ['a', 'b'], totals: [3, 1], memberCount: n }).totals).toBe(null);
      }),
    );
  });
  it('topic coverage names a lead, ranked by weakness', () => {
    const r = topicCoverage({ canTeach: { dp: ['s_ben', 's_ana'] }, weakTotals: { dp: 3, graphs: 1, none: 0 }, memberCount: 4 });
    expect(r).toEqual([{ topic: 'dp', weak: 3, lead: 's_ana' }, { topic: 'graphs', weak: 1, lead: null }]);
  });
});

describe('trip mediator', () => {
  const ids = ['cabo', 'flag', 'crawl'];
  it('full example: Cabo budget, crawl veto, Flagstaff wins', () => {
    const f = filterOptions({ optionIds: ids, cantAfford: [1, 0, 0], veto: [1, 0, 2], memberCount: 4 });
    expect(f.survivors).toEqual(['flag']);
    expect(f.dropped).toEqual([{ optionId: 'cabo', reason: 'budget' }, { optionId: 'crawl', reason: 'veto' }]);
    const surv = ['flag', 'cabo', 'extra'];
    const votes = [bordaVector(['flag', 'cabo', 'extra'], surv), bordaVector(['flag', 'extra', 'cabo'], surv), bordaVector(['cabo', 'flag'], surv)];
    const totals = surv.map((_, k) => votes.reduce((a, v) => a + v[k]!, 0));
    const t = tallyBorda({ optionIds: surv, totals, memberCount: 4 });
    expect(t.top2).toEqual(['flag', 'cabo']);
    expect(simulate({ top2: t.top2, noTotals: [0, 1] })).toBe('flag');
    expect(simulate({ top2: t.top2, noTotals: [1, 2] })).toBe(null);
  });
  it('filter vectors must match', () => {
    expect(() => filterOptions({ optionIds: ids, cantAfford: [0], veto: [0, 0, 0], memberCount: 4 })).toThrow();
  });
  it('borda: points sum to n(n-1)/2 for full rankings; ties keep option order', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(['a', 'b', 'c', 'd'], { minLength: 4 }), (r) => {
        const v = bordaVector(r, ['a', 'b', 'c', 'd']);
        expect(v.reduce((a, b) => a + b, 0)).toBe(6);
      }),
    );
    expect(tallyBorda({ optionIds: ['a', 'b', 'c'], totals: [1, 1, 1], memberCount: 4 }).ranking).toEqual(['a', 'b', 'c']);
  });
});

describe('split', () => {
  it('sums exactly, remainder to earliest', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 1, max: 12 }), (total, n) => {
        const payers = Array.from({ length: n }, (_, i) => `p${i}`);
        const s = splitEvenly(total, payers);
        expect(Object.values(s).reduce((a, b) => a + b, 0)).toBe(total);
        const vals = Object.values(s);
        expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
      }),
    );
    expect(splitEvenly(100, ['a', 'b', 'c'])).toEqual({ a: 34, b: 33, c: 33 });
  });
  it('venmo link always matches the protocol regex', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_.-]{1,30}$/), fc.string({ maxLength: 40 }), fc.integer({ min: 0, max: 9_999_999 }), (payee, note, cents) => {
        const link = venmoLink({ payee, amountCents: cents, note });
        if (encodeURIComponent(note).length <= 200) expect(VENMO_LINK.test(link)).toBe(true);
      }),
    );
  });
});
