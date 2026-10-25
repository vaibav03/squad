import { describe, expect, it } from 'vitest';
import {
  DIM_ALPHA,
  ROAD_DISTANCE,
  calmFrame,
  driveMs,
  fadeOutStartMs,
  totalMs,
  tripFrame,
  vanRestX,
} from './timeline';

const g = { viewW: 427, vanW: 64 };

describe('trip timeline', () => {
  it('starts dark-free and ends done with the door visible', () => {
    const a = tripFrame(0, g);
    expect(a.dim).toBe(0);
    expect(a.done).toBe(false);
    const z = tripFrame(totalMs(g), g);
    expect(z.done).toBe(true);
    expect(z.doorVisible).toBe(true);
    expect(z.doorPop).toBe(1);
    expect(z.dim).toBeCloseTo(0, 5);
  });
  it('the road covers its distance, decelerates to a stop, then the van drives linearly off screen', () => {
    const roadEnd = 250 + 2400;
    expect(tripFrame(roadEnd, g).roadOffset).toBeCloseTo(ROAD_DISTANCE, 3);
    expect(tripFrame(roadEnd, g).roadSpeedPxS).toBe(0);
    expect(tripFrame(250 + 1200, g).roadSpeedPxS).toBeGreaterThan(
      tripFrame(roadEnd - 100, g).roadSpeedPxS,
    );
    const d = driveMs(g);
    const a = tripFrame(roadEnd + d * 0.25, g).vanX;
    const b = tripFrame(roadEnd + d * 0.5, g).vanX;
    const c = tripFrame(roadEnd + d * 0.75, g).vanX;
    expect(Math.abs(b - a - (c - b))).toBeLessThanOrEqual(1); // constant speed (whole pixels)
    expect(tripFrame(roadEnd + d, g).vanX).toBeGreaterThanOrEqual(g.viewW + g.vanW / 2);
    expect(tripFrame(roadEnd, g).vanX).toBe(vanRestX(g));
  });
  it('dim holds while the van is on screen and never exceeds its cap', () => {
    for (let t = 0; t < totalMs(g); t += 50)
      expect(tripFrame(t, g).dim).toBeLessThanOrEqual(DIM_ALPHA + 1e-9);
    expect(tripFrame(1500, g).dim).toBeCloseTo(DIM_ALPHA, 3);
  });
  it('skip target is after the van has left and before the door pops', () => {
    const t = fadeOutStartMs(g);
    expect(tripFrame(t, g).vanX).toBeGreaterThanOrEqual(g.viewW);
    expect(tripFrame(t, g).doorVisible).toBe(false);
  });
  it('calm: card fades in, holds, fades out, then the door fades in', () => {
    expect(calmFrame(0).cardAlpha).toBe(0);
    expect(calmFrame(1000).cardAlpha).toBe(1);
    expect(calmFrame(2800).cardAlpha).toBeCloseTo(0, 3);
    expect(calmFrame(2800).doorAlpha).toBe(0);
    expect(calmFrame(3000).doorAlpha).toBe(1);
    expect(calmFrame(3000).done).toBe(true);
  });
});
