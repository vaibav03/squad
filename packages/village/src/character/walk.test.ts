import { describe, expect, it } from 'vitest';
import { STOP_MS, WALK_SPEED, WalkSim } from './walk';

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const run = (s: WalkSim, ms: number, dt = 16) => { for (let t = 0; t < ms; t += dt) s.step(dt); };

describe('WalkSim', () => {
  it('starts instantly at constant speed (no acceleration)', () => {
    const s = new WalkSim(100, 0, 1000, easeOut);
    s.setIntent(1);
    s.step(16);
    const d1 = s.x - 100;
    expect(d1).toBeCloseTo(WALK_SPEED * 0.016, 5);
    const x1 = s.x;
    s.step(16);
    expect(s.x - x1).toBeCloseTo(d1, 5);
    for (let i = 0; i < 100; i++) { const a = s.x; s.step(16); expect(s.x - a).toBeCloseTo(d1, 5); }
  });
  it('ease-out stop lasts STOP_MS and then idles', () => {
    const s = new WalkSim(100, 0, 1000, easeOut);
    s.setIntent(1); run(s, 500);
    s.setIntent(0);
    expect(s.cruising).toBe(false);
    run(s, STOP_MS - 1, 1);
    expect(s.walking).toBe(true);
    run(s, 2, 1);
    expect(s.walking).toBe(false);
  });
  it('walkTo arrives exactly on target and resolves true', () => {
    const s = new WalkSim(0, 0, 1000, easeOut);
    let ok: boolean | undefined;
    s.walkTo(200, (r) => (ok = r));
    run(s, 6000);
    expect(s.x).toBe(200);
    expect(ok).toBe(true);
  });
  it('a superseded walkTo resolves false; keyboard cancels targets', () => {
    const s = new WalkSim(0, 0, 1000, easeOut);
    const r: boolean[] = [];
    s.walkTo(500, (v) => r.push(v));
    run(s, 200);
    s.walkTo(100, (v) => r.push(v));
    expect(r).toEqual([false]);
    s.setIntent(1);
    expect(r).toEqual([false, false]);
  });
  it('clamps to world bounds and renders whole pixels', () => {
    const s = new WalkSim(5, 0, 50, easeOut);
    s.setIntent(-1); run(s, 1000);
    expect(s.x).toBe(0);
    s.teleport(33.3);
    expect(Number.isInteger(s.renderX)).toBe(true);
  });
});
