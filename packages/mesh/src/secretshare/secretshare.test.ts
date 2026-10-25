import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { seededRng } from '../crypto/rng.js';
import {
  SHARE_MODULUS,
  combineSums,
  decodeShares,
  encodeShares,
  secureSum,
  splitSecret,
  splitVector,
} from './index.js';

describe('secret sharing', () => {
  it('sums reconstruct totals', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 4, maxLength: 4 }), { minLength: 1, maxLength: 6 }),
        fc.string(),
        (rows, seed) => {
          const inputs: Record<string, number[]> = {};
          rows.forEach((r, i) => (inputs[`m${i}`] = r));
          const { totals } = secureSum(inputs, seededRng(seed));
          expect(totals).toEqual([0, 1, 2, 3].map((c) => rows.reduce((a, r) => a + r[c]!, 0)));
        },
      ),
    );
  });

  it('a single share vector looks uniform and hides the input', () => {
    const vals = new Array(200).fill(1);
    const s0 = splitVector(vals, 3, seededRng('a'))[0]!;
    const s1 = splitVector(vals, 3, seededRng('b'))[0]!;
    expect(s0.some((x, i) => x !== s1[i])).toBe(true);
    expect(s0.every((x) => x !== 1n)).toBe(true);
    const bytes = encodeShares(s0).join('');
    const counts = new Array(16).fill(0);
    for (const ch of bytes) counts[parseInt(ch, 16)]++;
    const exp = bytes.length / 16;
    const chi = counts.reduce((a, c) => a + (c - exp) ** 2 / exp, 0);
    expect(chi).toBeLessThan(80);
  });

  it('split sums to value mod p, incl. bigint', () => {
    const sh = splitSecret(42, 5, seededRng('z'));
    expect(sh.length).toBe(5);
    expect(sh.reduce((a, b) => a + b, 0n) % SHARE_MODULUS).toBe(42n);
    expect(() => splitSecret(-1, 2, seededRng('z'))).toThrow();
  });

  it('combineSums rejects non-counts', () => {
    const big = splitVector([1], 2, seededRng('x'));
    const bad = [[SHARE_MODULUS - 1n], [0n]]; // total p-1 >= 2^53
    expect(() => combineSums(bad)).toThrow();
    expect(combineSums(big)).toEqual([1]);
  });

  it('decode round-trips and rejects >= p and malformed', () => {
    const v = [0n, 5n, SHARE_MODULUS - 1n];
    expect(decodeShares(encodeShares(v))).toEqual(v);
    expect(() => decodeShares([SHARE_MODULUS.toString(16).padStart(32, '0')])).toThrow();
    expect(() => decodeShares(['ff'.repeat(16)])).toThrow();
    expect(() => decodeShares(['abc'])).toThrow();
  });
});
