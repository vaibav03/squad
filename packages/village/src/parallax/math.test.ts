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

import { millAlpha, parallaxWorldX } from './math';
describe('windmill clearance', () => {
  const slots = [
    { x: 2600, w: 128, kind: 'student-home' },
    { x: 1412, w: 139, kind: 'council-hall' },
  ];
  it('hides over a house and shows in the open', () => {
    expect(millAlpha(2600, slots)).toBe(0);
    expect(millAlpha(2600 + 64 + 36, slots)).toBe(0);
    expect(millAlpha(2600 + 64 + 36 + 48, slots)).toBe(1);
    expect(millAlpha(2000, slots)).toBe(1);
  });
});

describe('windmill placement over the real layout', () => {
  it('is hidden when its apparent world x is over home-3 (camera near x 2700) and visible in a gap', async () => {
    const { createLayout } = await import('../world/layout');
    const slots = createLayout().slots;
    // layer x 1650 at scrollX 2250 -> world 1650 + 0.4 * 2250 = 2550: over home-3 (2600, w128)
    expect(parallaxWorldX(1650, 2250, 0.6)).toBeCloseTo(2550);
    expect(millAlpha(parallaxWorldX(1650, 2250, 0.6), slots)).toBe(0);
    expect(millAlpha(parallaxWorldX(2800, 0, 0.6), slots)).toBe(1);
  });
});
