import { describe, expect, it } from 'vitest';
import { blend, clampCenter, scrollForCenter } from './math';

describe('camera math', () => {
  it('clamps centre so view stays inside the world', () => {
    expect(clampCenter(0, 320, 1, 2560)).toBe(160);
    expect(clampCenter(5000, 320, 1, 2560)).toBe(2400);
    expect(clampCenter(50, 320, 2, 2560)).toBe(80);
  });
  it('scroll is a whole pixel', () => {
    expect(Number.isInteger(scrollForCenter(1234.56, 321))).toBe(true);
  });
  it('blend starts at 0 and lands exactly on 1', () => {
    const e = (t: number) => t;
    expect(blend(0, e)).toBe(0);
    expect(blend(400, e)).toBe(1);
    expect(blend(9999, e)).toBe(1);
  });
});

import { scrollYBottom } from './math';
describe('bottom anchoring', () => {
  it('shows the bottom of the 270 layer set', () => {
    expect(scrollYBottom(240, 1, 270)).toBe(30);
    expect(scrollYBottom(270, 1, 270)).toBe(0);
    expect(scrollYBottom(240, 2, 270)).toBe(270 - 60 - 120);
  });
});
