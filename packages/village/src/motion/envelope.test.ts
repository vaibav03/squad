import { describe, expect, it } from 'vitest';
import { carryEnvelope, handOff, pinAtFire } from './envelope';
import { createRuntime } from './runtime';
import type { Animatable, Walker } from './types';

const mk = (x = 0, y = 0): Animatable => ({ x, y, alpha: 1, scaleX: 1, scaleY: 1 });
const walker = (x = 0, y = 0): Walker => ({ ...mk(x, y) });

describe('carryEnvelope', () => {
  it('pops in 180 ms at the door, rides above the walker, lands at the target', () => {
    const rt = createRuntime();
    const w = walker(0, 0);
    const e = mk();
    let arrived = 0;
    const h = carryEnvelope(rt, {
      walker: w,
      envelope: e,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      carryOffset: { x: 0, y: -10 },
      speedPxPerSec: 100,
      onArrive: () => arrived++,
    });
    expect([e.x, e.y, e.alpha, e.scaleX]).toEqual([0, -10, 0, 0.95]);
    rt.step(90);
    expect(e.alpha).toBeGreaterThan(0.5);
    expect(e.scaleX).toBeLessThan(1);
    rt.step(90);
    expect([e.alpha, e.scaleX, e.scaleY]).toEqual([1, 1, 1]);
    for (let i = 0; i < 6; i++) {
      rt.step(100);
      expect(e.x).toBe(w.x);
      expect(e.y).toBe(w.y - 10);
    }
    expect(h.done).toBe(false);
    rt.step(400);
    expect([w.x, e.x, e.y, h.done, arrived]).toEqual([100, 100, -10, true, 1]);
  });

  it('skip jumps both to the destination', () => {
    const rt = createRuntime();
    const w = walker();
    const e = mk();
    const h = carryEnvelope(rt, {
      walker: w,
      envelope: e,
      from: { x: 0, y: 0 },
      to: { x: 50, y: 20 },
    });
    rt.step(100);
    h.skip();
    expect([w.x, w.y, e.x, e.y, e.alpha, e.scaleX]).toEqual([50, 20, 50, 8, 1, 1]);
    expect(h.done).toBe(true);
  });

  it('cancel halts everything', () => {
    const rt = createRuntime();
    const w = walker();
    const e = mk();
    const h = carryEnvelope(rt, {
      walker: w,
      envelope: e,
      from: { x: 0, y: 0 },
      to: { x: 500, y: 0 },
    });
    rt.step(500);
    h.cancel();
    const x = w.x;
    rt.step(1000);
    expect([w.x, h.done]).toEqual([x, true]);
  });

  it('reduced: walker teleports, envelope fades in at the destination, no scale', () => {
    const rt = createRuntime({ reduced: true });
    const w = walker();
    const e = mk();
    let arrived = 0;
    const h = carryEnvelope(rt, {
      walker: w,
      envelope: e,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 40 },
      carryOffset: { x: 0, y: -10 },
      onArrive: () => arrived++,
    });
    expect([e.x, e.y, e.alpha]).toEqual([100, 30, 0]);
    rt.step(60);
    expect([w.x, w.y, e.alpha]).toEqual([100, 40, 0]);
    rt.step(30);
    expect(e.alpha).toBeGreaterThan(0);
    expect(e.alpha).toBeLessThan(1);
    rt.step(30);
    expect([e.alpha, e.scaleX, h.done, arrived]).toEqual([1, 1, true, 1]);
  });
});

describe('handOff', () => {
  it('320 ms ease-in-out glide with exact endpoints and whole pixels', () => {
    const rt = createRuntime();
    const e = mk(3, 3);
    let done = 0;
    const h = handOff(rt, {
      envelope: e,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 50 },
      onDone: () => done++,
    });
    expect([e.x, e.y]).toEqual([0, 0]);
    rt.step(160);
    expect(e.x).toBeGreaterThan(30);
    expect(e.x).toBeLessThan(70); // ease-in-out is symmetric-ish at the middle
    expect(Number.isInteger(e.x)).toBe(true);
    rt.step(159);
    expect(h.done).toBe(false);
    rt.step(1);
    expect([e.x, e.y, h.done, done]).toEqual([100, 50, true, 1]);
  });

  it('ease-in-out: slow start, slow end', () => {
    const rt = createRuntime();
    const e = mk();
    handOff(rt, { envelope: e, from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } });
    rt.step(32);
    expect(e.x).toBeLessThan(50);
    rt.step(256);
    expect(e.x).toBeGreaterThan(950);
  });

  it('staggers 60 ms per index and holds at from meanwhile', () => {
    const rt = createRuntime();
    const e = mk();
    const h = handOff(rt, {
      envelope: e,
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      staggerIndex: 2,
    });
    rt.step(119);
    expect(e.x).toBe(0);
    rt.step(1 + 320 - 1);
    expect(h.done).toBe(false);
    rt.step(1);
    expect([e.x, h.done]).toEqual([100, true]);
  });

  it('reduced: fade out at from, fade in at to', () => {
    const rt = createRuntime({ reduced: true });
    const e = mk();
    handOff(rt, { envelope: e, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    rt.step(30);
    expect(e.x).toBe(0);
    expect(e.alpha).toBeLessThan(1);
    rt.step(30);
    expect([e.x, e.alpha]).toEqual([100, 0]);
    rt.step(60);
    expect(e.alpha).toBe(1);
  });

  it('skip/cancel', () => {
    const rt = createRuntime();
    const e = mk();
    const h = handOff(rt, { envelope: e, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    rt.step(100);
    h.skip();
    expect(e.x).toBe(100);
    const e2 = mk();
    const h2 = handOff(rt, { envelope: e2, from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    rt.step(100);
    const x = e2.x;
    h2.cancel();
    rt.step(500);
    expect(e2.x).toBe(x);
  });
});

describe('pinAtFire', () => {
  it('pops in at the campfire in 180 ms', () => {
    const rt = createRuntime();
    const e = mk();
    const h = pinAtFire(rt, e, { x: 10.4, y: 20.6 });
    expect([e.x, e.y]).toEqual([10, 21]);
    rt.step(1);
    expect(e.scaleX).toBeLessThan(1);
    expect(e.scaleX).toBeGreaterThanOrEqual(0.95);
    rt.step(178);
    expect(h.done).toBe(false);
    rt.step(1);
    expect([e.alpha, e.scaleX, h.done]).toEqual([1, 1, true]);
  });
  it('reduced: alpha only', () => {
    const rt = createRuntime({ reduced: true });
    const e = mk();
    pinAtFire(rt, e, { x: 0, y: 0 });
    rt.step(90);
    expect(e.scaleX).toBe(1);
    expect(e.alpha).toBeGreaterThan(0);
    rt.step(90);
    expect(e.alpha).toBe(1);
  });
});
