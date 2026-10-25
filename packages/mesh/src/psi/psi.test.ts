import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { seededRng } from '../crypto/rng.js';
import { psiApply, psiKeygen, psiPrepare, runRingPsi } from './index.js';

const label = fc.integer({ min: 0, max: 15 }).map((i) => `slot-${i}`);
const partySets = fc
  .array(fc.uniqueArray(label, { maxLength: 10 }), { minLength: 2, maxLength: 5 })
  .filter(() => true);

describe('ring PSI', () => {
  it('each party resolves exactly the true intersection', () => {
    fc.assert(
      fc.property(partySets, fc.string(), (sets, seed) => {
        const parties = sets.map((items, i) => ({ id: `p${i}`, items }));
        const r = runRingPsi(parties, { padTo: 12, seed });
        const truth = sets.reduce((a, s) => a.filter((x) => s.includes(x))).sort();
        for (const p of parties) expect([...r.common[p.id]!].sort()).toEqual(truth);
      }),
      { numRuns: 25 },
    );
  }, 30_000); // CPU-heavy bigint property; the 5 s default flakes under a parallel `pnpm check`

  it('padding hides size and non-common tokens never collide', () => {
    const parties = [
      { id: 'a', items: ['x', 'c1', 'a1'] },
      { id: 'b', items: ['c1', 'b1', 'b2', 'b3'] },
      { id: 'c', items: ['c1'] },
    ];
    const r = runRingPsi(parties, { padTo: 20, seed: 's' });
    expect(r.wire.length).toBe(9);
    for (const w of r.wire) expect(w.points.length).toBe(20);
    expect(Object.values(r.mediatorView.tokenCounts)).toEqual([20, 20, 20]);
    expect(r.mediatorView.common.length).toBe(1);
    expect(r.common.a).toEqual(['c1']);
  });

  it('is deterministic with a seed', () => {
    const parties = [
      { id: 'a', items: ['x', 'y'] },
      { id: 'b', items: ['y'] },
    ];
    const a = runRingPsi(parties, { padTo: 8, seed: 'k' });
    const b = runRingPsi(parties, { padTo: 8, seed: 'k' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(runRingPsi(parties, { padTo: 8, seed: 'k2' }))).not.toBe(
      JSON.stringify(a),
    );
  });

  it('rejects invalid points', () => {
    const k = psiKeygen(seededRng('k'));
    expect(() => psiApply(k, ['zz'])).toThrow(/invalid point/);
    expect(() => psiApply(k, ['ff'.repeat(32)])).toThrow(/invalid point/);
    expect(() => psiApply(k, ['00'.repeat(32)])).toThrow();
  });

  it('throws when padTo < items', () => {
    const rng = seededRng('p');
    expect(() => psiPrepare(psiKeygen(rng), ['a', 'b', 'c'], { padTo: 2, rng })).toThrow();
  });

  it('keeps index aligned and pads to exact size', () => {
    const rng = seededRng('q');
    const { blinded, index } = psiPrepare(psiKeygen(rng), ['a', 'b'], { padTo: 6, rng });
    expect(blinded.length).toBe(6);
    expect(index.filter((x) => x === null).length).toBe(4);
  });

  it('keygen is in range', () => {
    const rng = seededRng('g');
    for (let i = 0; i < 20; i++) expect(psiKeygen(rng) > 0n).toBe(true);
  });
});
