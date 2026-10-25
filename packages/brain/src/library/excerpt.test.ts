import { describe, expect, it } from 'vitest';
import { buildExcerpt } from './excerpt';

const page = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} filler words about nothing.`);
page[9] = 'The standard deviation measures spread, and';
page[10] = 'the variance is its square.';
const text = page.join('\n');

describe('buildExcerpt', () => {
  it('marks hit lines (also across a line break) with +-3 context', () => {
    const r = buildExcerpt(
      text,
      'Standard deviation measures spread, and the variance is its square',
    );
    expect(r.quoteVerified).toBe(true);
    expect(r.lines.map((l) => l.n)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(r.lines.filter((l) => l.hit).map((l) => l.n)).toEqual([10, 11]);
  });
  it('an invented quote is unverified and highlights nothing', () => {
    const r = buildExcerpt(text, 'the median is always larger than the mean');
    expect(r.quoteVerified).toBe(false);
    expect(r.lines.some((l) => l.hit)).toBe(false);
    expect(r.lines.length).toBeLessThanOrEqual(12);
  });
  it('without a quote returns the top of the page', () => {
    const r = buildExcerpt(text, null);
    expect(r.lines[0]).toEqual({ n: 1, text: page[0], hit: false });
  });
  it('clips at page edges', () => {
    const r = buildExcerpt('Alpha beta gamma delta.\nsecond line', 'alpha beta gamma delta');
    expect(r.lines.map((l) => l.n)).toEqual([1, 2]);
    expect(r.lines[0]!.hit).toBe(true);
  });
});
