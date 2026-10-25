import { describe, expect, it } from 'vitest';
import { flicker, targetNightness, tileOffset, twinkle } from './math';

describe('parallax math', () => {
  it('nightness by mode and clock', () => {
    expect(targetNightness('night', 0)).toBe(1);
    expect(targetNightness('day', 0)).toBe(0);
    expect(targetNightness('auto', 23)).toBe(1);
    expect(targetNightness('auto', 12)).toBe(0);
    expect(targetNightness('auto', 19)).toBeCloseTo(0.5);
    expect(targetNightness('auto', 6.5)).toBeCloseTo(0.5);
  });
  it('tile offset is whole pixels and wraps', () => {
    expect(Number.isInteger(tileOffset(123.7, 0.33))).toBe(true);
    expect(tileOffset(-5, 1)).toBe(315);
    expect(tileOffset(640, 1)).toBe(0);
  });
  it('twinkle and flicker stay in range', () => {
    for (let t = 0; t < 8000; t += 100) {
      expect(twinkle(t, 3000)).toBeGreaterThanOrEqual(0.82);
      expect(twinkle(t, 3000)).toBeLessThanOrEqual(1);
      expect(flicker(t)).toBeGreaterThanOrEqual(0.85);
      expect(flicker(t)).toBeLessThanOrEqual(1);
    }
    expect(flicker(0)).toBeCloseTo(0.85);
    expect(flicker(2000)).toBeCloseTo(1);
  });
});
