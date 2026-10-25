import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Claim } from '../experts/types';
import type { Page } from '../ingest/types';
import {
  formatMarker,
  humanizeMarkers,
  normalizeText,
  parseMarkers,
  quoteOnPage,
  renderAnswer,
  stripMarkers,
  verifyClaims,
} from './index';

const word = fc.stringMatching(/^[a-z]{3,9}$/);
const text = fc.array(word, { minLength: 12, maxLength: 60 }).map((w) => w.join(' '));
const page = (t: string, n = 1, file = 'f.pdf'): Page => ({
  courseId: 'c',
  chapter: 'ch1',
  file,
  page: n,
  text: t,
});
const claim = (quote: string, p = 1, file = 'f.pdf'): Claim => ({
  text: 't',
  file,
  page: p,
  quote,
});

describe('quoteOnPage properties', () => {
  it('any 3+ word window of a page verifies, even after case/space/punctuation noise', () => {
    fc.assert(
      fc.property(text, fc.nat(), fc.integer({ min: 3, max: 9 }), (t, start, len) => {
        const words = t.split(' ');
        const s = start % (words.length - len);
        const quote = words.slice(s, s + len).join(' ');
        fc.pre(quote.length >= 12);
        expect(quoteOnPage(quote, t)).toBe(true);
        const noisy = `  ${quote.toUpperCase().replace(/ /g, ' \n ,  ')}.  `;
        expect(quoteOnPage(noisy, t)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('a quote from page A is struck against page B (disjoint text)', () => {
    fc.assert(
      fc.property(text, text, (a, b) => {
        fc.pre(!normalizeText(b).includes(normalizeText(a).slice(0, 14)));
        const quote = a.split(' ').slice(0, 5).join(' ');
        fc.pre(quote.length >= 12 && !normalizeText(b).includes(normalizeText(quote)));
        const { verified, struck } = verifyClaims([claim(quote, 2)], [page(a, 1), page(b, 2)]);
        expect(verified).toHaveLength(0);
        expect(struck).toHaveLength(1);
      }),
      { numRuns: 200 },
    );
  });

  it('fabricated quotes never verify', () => {
    fc.assert(
      fc.property(
        text,
        fc.array(fc.stringMatching(/^[A-Z]{4,8}$/), { minLength: 4, maxLength: 8 }),
        (t, fake) => {
          expect(quoteOnPage(fake.join(' '), t)).toBe(false);
        },
      ),
    );
  });

  it('verified and struck partition the input, order preserved', () => {
    fc.assert(
      fc.property(
        text,
        fc.array(fc.tuple(fc.boolean(), fc.integer({ min: 0, max: 3 })), { maxLength: 10 }),
        (t, specs) => {
          const words = t.split(' ');
          const claims = specs.map(([real, shift], i) =>
            claim(
              real
                ? words.slice(shift, shift + 5).join(' ')
                : `zzzz${i} qqqq${i} wwww${i} xxxx${i}`,
            ),
          );
          const { verified, struck } = verifyClaims(claims, [page(t)]);
          expect(verified.length + struck.length).toBe(claims.length);
          const merged = claims.filter((c) => verified.includes(c) || struck.includes(c));
          expect(merged).toEqual(claims);
          for (const v of verified) expect(quoteOnPage(v.quote, t)).toBe(true);
        },
      ),
    );
  });

  it('renderAnswer never cites a page that is not in its citations', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 1, maxLength: 5 }),
        (pages) => {
          const a = renderAnswer(
            pages.map((p) => ({
              text: 'A claim.',
              file: 'f.pdf',
              page: p,
              quote: 'one two three',
            })),
            { courseId: 'c', chapter: 'ch1' },
          );
          const cited = new Set(a.citations.map((c) => c.page));
          for (const m of parseMarkers(
            humanizeMarkers(a.text).replace(/\((.+?) p\.(\d+)\)/g, '[$1 p.$2]'),
          ))
            expect(cited.has(m.page)).toBe(true);
        },
      ),
    );
  });

  it('marker format round-trips', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9._-]{1,20}$/),
        fc.integer({ min: 1, max: 9999 }),
        (f, n) => {
          const m = parseMarkers(`before ${formatMarker(f, n)} after`);
          expect(m).toHaveLength(1);
          expect(m[0]).toMatchObject({ file: f, page: n });
          expect(stripMarkers(`before ${formatMarker(f, n)} after`)).toBe('before after');
        },
      ),
    );
  });
});

describe('quoteOnPage and verifyClaims table', () => {
  const t =
    'Std dev is the square root of the vari-\nance. The “empirical rule” says 68% – 95% – 99.7%.';
  it.each([
    ['hyphenated line break', 'square root of the variance', true],
    ['curly vs straight quotes', 'The "empirical rule" says 68', true],
    ['en dash vs hyphen', 'rule” says 68% - 95% - 99.7%', true],
    ['empty quote', '', false],
    ['too short', 'the', false],
    ['two words only', 'square root', false],
    ['partial word is not a match', 'the squar root of the', false],
    ['case', 'STD DEV IS THE SQUARE ROOT', true],
  ])('%s', (_n, q, want) => expect(quoteOnPage(q, t)).toBe(want));

  it('rejects wrong file, page 0, negative and non-integer pages', () => {
    const pages = [page(t, 1)];
    const q = 'square root of the variance';
    expect(verifyClaims([claim(q, 1)], pages).verified).toHaveLength(1);
    for (const c of [
      claim(q, 1, 'other.pdf'),
      claim(q, 0),
      claim(q, -1),
      claim(q, 1.5),
      claim(q, 2),
    ])
      expect(verifyClaims([c], pages).verified).toHaveLength(0);
  });

  it('unicode text is handled', () => {
    expect(
      quoteOnPage('σ measures the spread of data', 'Here σ measures the spread of data well'),
    ).toBe(true);
  });

  it('empty verified list renders the exact refusal', () => {
    expect(renderAnswer([], { courseId: 'c', chapter: 'ch1' })).toMatchObject({
      grounded: false,
      text: 'Not in the materials. Ask the TA.',
      citations: [],
    });
  });
});
