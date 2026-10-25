import { describe, expect, it } from 'vitest';
import { computeScale } from './scaler';

describe('computeScale (integer art scaling)', () => {
  it('desktop 1280x720 at DPR1 is 3x: 426x240 native', () => {
    const s = computeScale(1280, 720, 1);
    expect(s).toMatchObject({ zoom: 3, k: 3, logicalW: 426, logicalH: 240 });
  });
  it('phone 390x800 is 2x with the full 270 layer height', () => {
    const s = computeScale(390, 800, 3);
    expect(s).toMatchObject({ zoom: 2, k: 6, logicalW: 195, logicalH: 270 });
    expect(s.cssPerPx).toBe(2);
  });
  it('device pixels per art pixel are whole at fractional DPR', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
      const s = computeScale(1280, 720, dpr);
      expect(Number.isInteger(s.k)).toBe(true);
      expect(s.k).toBeGreaterThanOrEqual(s.zoom);
      expect(Number.isInteger(Math.round(s.cssW * dpr))).toBe(true);
    }
  });
  it('short windows drop a zoom step instead of cropping the sky away', () => {
    expect(computeScale(1000, 400, 1).zoom).toBe(2);
  });
});
