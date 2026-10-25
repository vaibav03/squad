import { describe, expect, it } from 'vitest';
import { CURVES, cubicBezier, spring, lerpColor } from './curves';
import { createMotionPrefs, fixedPrefs } from './prefs';
import { createRuntime, MotionRuntime } from './runtime';
import { bubbleHoldMs, DURATION } from './tokens';
import type { Animatable } from './types';

const a = (): Animatable => ({ x: 0, y: 0, alpha: 1, scaleX: 1, scaleY: 1 });

describe('curves', () => {
  it.each(Object.entries(CURVES))('%s has exact endpoints', (_n, c) => {
    expect(c(0)).toBe(0);
    expect(c(1)).toBe(1);
  });
  it('ease-out is front-loaded (css cubic-bezier(0.23,1,0.32,1))', () => {
    expect(CURVES.easeOut(0.1)).toBeGreaterThan(0.3);
    expect(CURVES.easeOut(0.5)).toBeGreaterThan(0.9);
  });
  it('ease-in-out is monotonic', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = CURVES.easeInOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it('ease-drawer is front-loaded', () => {
    expect(CURVES.easeDrawer(0.3)).toBeGreaterThan(0.5);
  });
  it('identity bezier is linear', () => {
    expect(cubicBezier(0, 0, 1, 1)(0.37)).toBeCloseTo(0.37, 4);
  });
  it('spring overshoots slightly and lands on 1', () => {
    const s = spring({ bounce: 0.2 });
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(1);
    const max = Math.max(...Array.from({ length: 101 }, (_, i) => s(i / 100)));
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.35);
  });
  it('lerpColor endpoints', () => {
    expect(lerpColor(0x000000, 0xffffff, 0)).toBe(0);
    expect(lerpColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
  });
});

describe('prefs', () => {
  it('calm and reduced combine, calm persists, override beats OS', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const p = createMotionPrefs({ storage, matchMedia: null });
    expect(p.effectiveReduced).toBe(false);
    p.setCalm(true);
    expect(p.effectiveReduced).toBe(true);
    expect(createMotionPrefs({ storage, matchMedia: null }).calm).toBe(true);
    p.setCalm(false);
    p.setReducedOverride(true);
    expect(p.effectiveReduced).toBe(true);
    let n = 0;
    p.subscribe(() => n++);
    p.setReducedOverride(null);
    expect(n).toBe(1);
    expect(p.effectiveReduced).toBe(false);
  });
  it('survives throwing storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    const p = createMotionPrefs({ storage, matchMedia: null });
    expect(() => p.setCalm(true)).not.toThrow();
    expect(p.calm).toBe(true);
  });
  it('fixedPrefs', () => {
    expect(fixedPrefs(true).effectiveReduced).toBe(true);
    expect(fixedPrefs(false, true).effectiveReduced).toBe(true);
    expect(fixedPrefs(false).effectiveReduced).toBe(false);
  });
});

describe('runtime tween', () => {
  it('hits exact end state at exact duration and snaps pixels', () => {
    const rt = createRuntime();
    const t = a();
    let done = false;
    rt.tween(
      t,
      { x: 100.4, alpha: 0 },
      { duration: 200, curve: CURVES.linear, onComplete: () => (done = true) },
    );
    rt.step(100);
    expect(t.x).toBe(50);
    expect(t.alpha).toBeCloseTo(0.5, 5);
    rt.step(99);
    expect(done).toBe(false);
    rt.step(1);
    expect(done).toBe(true);
    expect(t.x).toBe(100);
    expect(rt.activeCount).toBe(0);
  });
  it('delay and from', () => {
    const rt = createRuntime();
    const t = a();
    rt.tween(
      t,
      { alpha: 1 },
      { duration: 100, curve: CURVES.linear, delay: 50, from: { alpha: 0 } },
    );
    expect(t.alpha).toBe(0);
    rt.step(50);
    expect(t.alpha).toBe(0);
    rt.step(50);
    expect(t.alpha).toBeCloseTo(0.5, 5);
  });
  it('skip jumps to end, cancel does not', async () => {
    const rt = createRuntime();
    const t = a();
    const h = rt.tween(t, { x: 10 }, { duration: 100 });
    h.skip();
    expect(t.x).toBe(10);
    await h.finished;
    const t2 = a();
    const h2 = rt.tween(t2, { x: 10 }, { duration: 100, curve: CURVES.linear });
    rt.step(50);
    h2.cancel();
    expect(t2.x).toBe(5);
    expect(h2.done).toBe(true);
  });
  it('timeScale slows, pause freezes, delta clamps, resume does not catch up', () => {
    const rt = new MotionRuntime({ prefs: fixedPrefs(false) });
    const t = a();
    rt.tween(t, { x: 1000 }, { duration: 1000, curve: CURVES.linear });
    rt.timeScale = 0.25;
    rt.update(100);
    expect(t.x).toBe(25);
    rt.paused = true;
    rt.update(100);
    expect(t.x).toBe(25);
    rt.paused = false;
    rt.timeScale = 1;
    rt.update(5000); // clamped to 100 ms
    expect(t.x).toBe(125);
    rt.dropNextDelta();
    rt.update(100);
    expect(t.x).toBe(125);
    rt.update(100);
    expect(t.x).toBe(225);
  });
  it('after() fires once', () => {
    const rt = createRuntime();
    let n = 0;
    rt.after(100, () => n++);
    rt.step(99);
    expect(n).toBe(0);
    rt.step(5);
    rt.step(100);
    expect(n).toBe(1);
  });
});

describe('tokens', () => {
  it('bubble hold: 1.2 s per 20 chars, min 1.2 s', () => {
    expect(bubbleHoldMs('hi')).toBe(1200);
    expect(bubbleHoldMs('x'.repeat(40))).toBe(2400);
  });
  it('durations match the 08 table', () => {
    expect(DURATION.bubbleIn).toBe(160);
    expect(DURATION.cameraPan).toBe(400);
    expect(DURATION.tripScroll).toBe(2400);
  });
});
