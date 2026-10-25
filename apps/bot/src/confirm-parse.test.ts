import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseConfirmReply as p } from './confirm-parse';

const O3 = ['Friday 3pm', 'Saturday 10am', 'Neither works'];
const idx = (t: string, o = O3) => {
  const r = p(t, o);
  return r.kind === 'match' ? r.index : -1;
};

describe('parseConfirmReply', () => {
  it.each([
    ['2', 1],
    ['2.', 1],
    ['2)', 1],
    ['#2', 1],
    [' option 2 ', 1],
    ['two', 1],
    ['3', 2],
    ['1️⃣', 0],
    ['２', 1],
  ])('number %j -> %i', (t, i) => expect(idx(t)).toBe(i));

  it.each(['0', '4', '-1', '1e3', '99', 'I have 2 exams', 'maybe 2 or 3', '', '   ', '12'])(
    'rejects %j',
    (t) => expect(idx(t)).toBe(-1),
  );

  it('option text, case-insensitive, padded, with punctuation', () => {
    expect(idx('  SATURDAY 10AM!! ')).toBe(1);
    expect(idx('friday 3pm please')).toBe(0);
  });
  it('unique prefix of 3+ chars and unique word', () => {
    expect(idx('sat')).toBe(1);
    expect(idx('fri')).toBe(0);
    expect(idx('neither')).toBe(2);
    expect(idx('10am')).toBe(1);
    expect(idx('s')).toBe(-1);
    expect(idx('3pm 10am')).toBe(-1);
  });
  it('yes/no synonyms need exactly one yes-like and one no-like', () => {
    const yn = ['Yes, book it', 'No thanks'];
    expect(idx('yes', yn)).toBe(0);
    expect(idx('Yep', yn)).toBe(0);
    expect(idx('nah', yn)).toBe(1);
    expect(idx('yeah', ['Yes', 'Yes, but later', 'No'])).toBe(-1);
    expect(idx('yes', ['Yes', 'Yes, but later', 'No'])).toBe(0); // exact text wins
    expect(idx('yes', ['Friday', 'Saturday'])).toBe(-1);
  });
  it('degenerate option lists', () => {
    expect(p('1', [])).toEqual({ kind: 'none' });
    expect(idx('1', ['Only'])).toBe(0);
    expect(idx('2', ['Only'])).toBe(-1);
  });
  it('never throws on hostile strings', () => {
    for (const t of ['\u0000', 'a'.repeat(100_000), '\uD800', '‮1', '😀'.repeat(500)]) {
      expect(() => p(t, O3)).not.toThrow();
    }
  });

  const opts = fc
    .uniqueArray(fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{3,18}[A-Za-z0-9]$/), {
      minLength: 1,
      maxLength: 9,
    })
    .filter(
      (a) => new Set(a.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim())).size === a.length,
    );

  it('property: total, in range, option equals options[index]', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 60 }),
        fc.array(fc.string({ maxLength: 20 }), { maxLength: 9 }),
        (t, o) => {
          const r = p(t, o);
          if (r.kind === 'match') {
            expect(r.index).toBeGreaterThanOrEqual(0);
            expect(r.index).toBeLessThan(o.length);
            expect(r.option).toBe(o[r.index]);
          }
        },
      ),
      { seed: 42, numRuns: 400 },
    );
  });
  it('property: digit of any valid index matches that index', () => {
    fc.assert(
      fc.property(opts, (o) => {
        o.forEach((_, i) => expect(idx(String(i + 1), o)).toBe(i));
        expect(idx(String(o.length + 1), o)).toBe(-1);
      }),
      { seed: 7, numRuns: 200 },
    );
  });
  it('property: exact option text round-trips in any case with padding', () => {
    fc.assert(
      fc.property(opts, fc.boolean(), (o, upper) => {
        o.forEach((x, i) => {
          const t = ` ${upper ? x.toUpperCase() : x.toLowerCase()} `;
          // purely numeric-word options such as "one" are legitimately number words; skip those
          if (
            /^(?:option |number )?\w+$/i.test(x.trim()) &&
            /^(one|two|three|four|five|six|seven|eight|nine)$/i.test(x.trim())
          )
            return;
          expect(idx(t, o)).toBe(i);
        });
      }),
      { seed: 11, numRuns: 200 },
    );
  });
  it('property: an unrelated long sentence containing a digit never matches a number', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom('I have', 'we need', 'maybe'),
        (n, lead) => {
          expect(idx(`${lead} ${n} exams this week and a lot to do`)).toBe(-1);
        },
      ),
      { seed: 3 },
    );
  });
  it('property: whitespace padding does not change the result', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.nat(5), fc.nat(5), (t, a, b) => {
        expect(p(' '.repeat(a) + t + ' '.repeat(b), O3)).toEqual(p(t, O3));
      }),
      { seed: 5, numRuns: 300 },
    );
  });
});
