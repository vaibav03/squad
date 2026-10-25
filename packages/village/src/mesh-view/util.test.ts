import { describe, expect, it } from 'vitest';
import { bubbleBody, nextStagger } from './util';

describe('bubbleBody', () => {
  it('keeps short text whole and prefixes bullets', () => {
    expect(bubbleBody('Ana shared diet', ['vegetarian'])).toBe('Ana shared diet\n- vegetarian');
    expect(bubbleBody('Ana kept diet', ['hidden'], false)).toBe('Ana kept diet\nhidden');
  });
  it('clips to 60 characters and at most 3 lines', () => {
    const long = bubbleBody('x'.repeat(100), ['a', 'b', 'c', 'd']);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
    expect(bubbleBody('a', ['b', 'c', 'd', 'e'], false).split('\n')).toHaveLength(3);
  });
});

describe('nextStagger', () => {
  it('counts hand-offs started within the window', () => {
    const s: number[] = [];
    expect(nextStagger(s, 0)).toBe(0);
    expect(nextStagger(s, 100)).toBe(1);
    expect(nextStagger(s, 399)).toBe(2);
    expect(nextStagger(s, 450)).toBe(2); // t=0 expired
    expect(nextStagger(s, 2000)).toBe(0);
  });
});
