import { describe, expect, it } from 'vitest';
import { excerptWindow } from './excerpt';

const PAGE =
  'The curve is symmetric about a vertical line. A z-score is measured in units of the standard deviation. ' +
  'If X is a normally distributed random variable then the z-score tells you how many standard deviations the value is from the mean. ' +
  'Tables are rarely needed today. '.repeat(40);

describe('excerptWindow', () => {
  it('opens at the sentence that matches the answer, highlights it, never cuts mid-word', () => {
    const w = excerptWindow(PAGE, 'A z-score is measured in units of the standard deviation.');
    expect(w.highlight).toBe('A z-score is measured in units of the standard deviation.');
    expect(w.excerpt.startsWith('… ')).toBe(false); // previous sentence is included, so the window starts at 0
    expect(w.excerpt).toContain('A z-score is measured');
    expect(w.excerpt.length).toBeLessThanOrEqual(710);
    expect(w.excerpt.endsWith('…')).toBe(true);
    expect(w.excerpt).not.toMatch(/\bcur\b\s*…$/);
  });
  it('without context or a good match it opens at the top of the page', () => {
    const w = excerptWindow(PAGE, undefined);
    expect(w.highlight).toBeUndefined();
    expect(w.excerpt.startsWith('The curve is symmetric')).toBe(true);
    expect(excerptWindow(PAGE, 'unrelated words entirely').highlight).toBeUndefined();
  });
  it('a short page is returned whole', () => {
    expect(excerptWindow('One sentence only.', 'sentence').excerpt).toBe('One sentence only.');
  });
});
