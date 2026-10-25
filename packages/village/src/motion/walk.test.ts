import { describe, expect, it } from 'vitest';
import { createRuntime } from './runtime';
import { frameLoop, walkFrame, walkTo } from './walk';
import type { MotionRuntime } from './runtime';
import type { Walker } from './types';

const run = (rt: MotionRuntime, ms: number, dt = 5): void => {
  for (let t = 0; t < ms; t += dt) rt.step(dt);
};

const mk = (x = 0, y = 0): Walker & { frames: number[]; facing: string[] } => {
  const w = {
    x,
    y,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    frames: [] as number[],
    facing: [] as string[],
    setFrame(i: number) {
      w.frames.push(i);
    },
    setFacing(d: string) {
      w.facing.push(d);
    },
  };
  return w;
};

describe('walkFrame', () => {
  it('cycles 0..3 at 8 fps', () => {
    expect([0, 124, 125, 250, 375, 500, 625].map(walkFrame)).toEqual([0, 0, 1, 2, 3, 0, 1]);
  });
});

describe('walkTo', () => {
  it('starts instantly, constant speed, whole pixels, 80 ms stop, exact arrival', () => {
    const rt = createRuntime();
    const w = mk();
    let arrived = 0;
    walkTo(rt, w, { x: 100, y: 0 }, { speedPxPerSec: 100, onArrive: () => arrived++ }); // 1000 ms total
    expect(w.x).toBe(0);
    rt.step(1);
    expect(w.x).toBe(0); // 0.1 px rounds to 0 but time moved: no ease-in lag beyond rounding
    rt.step(9);
    expect(w.x).toBe(1); // 10 ms * 0.1 px/ms
    const xs: number[] = [];
    for (let i = 0; i < 9; i++) {
      rt.step(100);
      xs.push(w.x);
      expect(Number.isInteger(w.x)).toBe(true);
    }
    // t = 110..910 ... constant section ends at 920 ms: equal px per equal ms
    expect(xs).toEqual([11, 21, 31, 41, 51, 61, 71, 81, 91]);
    expect(arrived).toBe(0);
    rt.step(10); // 920 ms: last of constant section
    expect(w.x).toBe(92);
    rt.step(40); // mid stop
    expect(w.x).toBeGreaterThan(92 + 8 * 0.5); // ease-out front-loaded: more than half of the 8px
    expect(w.x).toBeGreaterThan(96);
    rt.step(40);
    expect(w.x).toBe(100);
    expect(arrived).toBe(1);
  });

  it('stop is ease-out: decelerating steps in the final 80 ms', () => {
    const rt = createRuntime();
    const w = mk();
    walkTo(rt, w, { x: 480, y: 0 }, { speedPxPerSec: 480 }); // 1000 ms, stretch 38.4 px
    rt.step(920);
    const p = w.x;
    const deltas: number[] = [];
    let prev = p;
    for (let i = 0; i < 8; i++) {
      rt.step(10);
      deltas.push(w.x - prev);
      prev = w.x;
    }
    expect(w.x).toBe(480);
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]!).toBeLessThanOrEqual(deltas[i - 1]!);
    expect(deltas[0]!).toBeGreaterThan(deltas[7]!);
  });

  it('cycles frames at 8 fps then idle frame on arrival', () => {
    const rt = createRuntime();
    const w = mk();
    walkTo(rt, w, { x: 100, y: 0 }, { speedPxPerSec: 100, idleFrame: 7 });
    run(rt, 1000);
    expect(w.frames.slice(0, 9)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 7]);
    expect(w.frames[w.frames.length - 1]).toBe(7);
    expect(w.facing).toEqual(['right']);
  });

  it('faces the dominant axis and walks diagonals on whole pixels', () => {
    const rt = createRuntime();
    const w = mk();
    walkTo(rt, w, { x: -30, y: 40 }, { speedPxPerSec: 50 });
    for (let i = 0; i < 20; i++) {
      rt.step(33);
      expect(Number.isInteger(w.x) && Number.isInteger(w.y)).toBe(true);
    }
    rt.step(1000);
    expect([w.x, w.y]).toEqual([-30, 40]);
    expect(w.facing).toEqual(['down']);
  });

  it('skip jumps to target and fires onArrive; cancel stops where it is', () => {
    const rt = createRuntime();
    const w = mk();
    let arrived = 0;
    const h = walkTo(rt, w, { x: 100, y: 0 }, { speedPxPerSec: 100, onArrive: () => arrived++ });
    rt.step(300);
    h.skip();
    expect(h.done).toBe(true);
    expect([w.x, arrived]).toEqual([100, 1]);
    const w2 = mk();
    let a2 = 0;
    const h2 = walkTo(rt, w2, { x: 100, y: 0 }, { speedPxPerSec: 100, onArrive: () => a2++ });
    rt.step(300);
    const at = w2.x;
    h2.cancel();
    rt.step(1000);
    expect([w2.x, a2, h2.done]).toEqual([at, 0, true]);
  });

  it('zero distance arrives immediately', () => {
    const rt = createRuntime();
    const w = mk(5, 5);
    let arrived = 0;
    const h = walkTo(rt, w, { x: 5, y: 5 }, { onArrive: () => arrived++ });
    expect([h.done, arrived]).toEqual([true, 1]);
  });

  it('reduced: 60 ms fade out, snap, 60 ms fade in, no frames', () => {
    const rt = createRuntime({ reduced: true });
    const w = mk();
    let arrived = 0;
    const h = walkTo(rt, w, { x: 100, y: 40 }, { onArrive: () => arrived++ });
    rt.step(30);
    expect(w.x).toBe(0);
    expect(w.alpha).toBeGreaterThan(0);
    expect(w.alpha).toBeLessThan(1);
    rt.step(29);
    expect(w.x).toBe(0);
    rt.step(1); // 60 ms
    expect([w.x, w.y, w.alpha]).toEqual([100, 40, 0]);
    rt.step(30);
    expect(w.alpha).toBeGreaterThan(0.5);
    expect(h.done).toBe(false);
    rt.step(30);
    expect([w.alpha, h.done, arrived]).toEqual([1, true, 1]);
    expect(w.frames).toEqual([]);
  });

  it('calm mode takes the reduced branch', () => {
    const rt = createRuntime({ calm: true });
    const w = mk();
    walkTo(rt, w, { x: 100, y: 0 });
    rt.step(60);
    expect(w.x).toBe(100);
  });
});

describe('frameLoop', () => {
  it('2 frames at 2 fps', () => {
    const rt = createRuntime();
    const seen: number[] = [];
    frameLoop(rt, (i) => seen.push(i), { frames: 2, fps: 2 });
    rt.step(499);
    rt.step(1);
    rt.step(500);
    rt.step(500);
    expect(seen).toEqual([0, 1, 0, 1]);
  });
  it('8 fps cadence: one change per 125 ms', () => {
    const rt = createRuntime();
    const seen: number[] = [];
    frameLoop(rt, (i) => seen.push(i), { frames: 4, fps: 8 });
    run(rt, 1000);
    expect(seen).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0]);
  });
  it('cancel stops it; skip lands on rest frame', () => {
    const rt = createRuntime();
    const seen: number[] = [];
    const h = frameLoop(rt, (i) => seen.push(i), { frames: 4, fps: 8, reducedFrame: 2 });
    rt.step(130);
    h.cancel();
    const n = seen.length;
    rt.step(1000);
    expect(seen.length).toBe(n);
    const seen2: number[] = [];
    const h2 = frameLoop(rt, (i) => seen2.push(i), { frames: 4, fps: 8, reducedFrame: 2 });
    rt.step(130);
    h2.skip();
    expect(seen2[seen2.length - 1]).toBe(2);
    expect(h2.done).toBe(true);
  });
  it('reduced: single static frame', () => {
    const rt = createRuntime({ reduced: true });
    const seen: number[] = [];
    const h = frameLoop(rt, (i) => seen.push(i), { frames: 2, fps: 2, reducedFrame: 1 });
    rt.step(5000);
    expect(seen).toEqual([1]);
    expect(h.done).toBe(true);
  });
});
