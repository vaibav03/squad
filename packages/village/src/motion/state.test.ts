import { describe, expect, it } from 'vitest';
import { easeInOut } from './curves';
import { createRuntime } from './runtime';
import {
  conflictMarker,
  waitingRing,
  ringToCheck,
  lanternFlicker,
  litWindow,
  confirmTick,
} from './markers';
import { speaking, smoothAmplitude } from './speaking';
import { cloudDrift, dayNight, parallaxStep } from './ambient';
import { cameraPan, buildingTransition } from './camera';
import { cutscene, tripCutscene } from './cutscene';
import type { Animatable } from './types';

const a = (): Animatable => ({ x: 0, y: 0, alpha: 1, scaleX: 1, scaleY: 1 });

describe('conflictMarker (row 9)', () => {
  it('pops with spring, ends exactly at scale 1, tint set, overshoot bounded', () => {
    const rt = createRuntime();
    const m = Object.assign(a(), {
      tint: 0,
      setTint(v: number) {
        this.tint = v;
      },
    });
    conflictMarker(rt, m);
    expect(m.scaleX).toBeCloseTo(0.6, 5);
    expect(m.tint).toBe(0xc8442f);
    let max = 0;
    for (let i = 0; i < 21; i++) {
      rt.step(17.5);
      max = Math.max(max, m.scaleX);
    }
    expect(m.scaleX).toBe(1);
    expect(max).toBeLessThan(1.3);
    expect(max).toBeGreaterThanOrEqual(1);
    expect(m.x).toBe(0); // no shake
  });
  it('reduced: static, no pop', () => {
    const rt = createRuntime({ reduced: true });
    const m = a();
    m.scaleX = 0.5;
    const h = conflictMarker(rt, m);
    expect(h.done).toBe(true);
    expect(m.scaleX).toBe(1);
  });
});

describe('waitingRing (row 10)', () => {
  it('loops 1.6 s, scale 1..1.15, alpha .6..0, stops cleanly', () => {
    const rt = createRuntime();
    const r = a();
    const h = waitingRing(rt, r);
    expect(r.alpha).toBeCloseTo(0.6, 5);
    expect(r.scaleX).toBe(1);
    rt.step(800);
    expect(r.scaleX).toBeGreaterThan(1.1);
    expect(r.alpha).toBeLessThan(0.1);
    rt.step(800.0001);
    expect(r.alpha).toBeGreaterThan(0.55); // new cycle
    for (let i = 0; i < 100; i++) {
      rt.step(16);
      expect(r.scaleX).toBeGreaterThanOrEqual(1);
      expect(r.scaleX).toBeLessThanOrEqual(1.15);
      expect(r.alpha).toBeLessThanOrEqual(0.6);
    }
    h.stop(100);
    rt.step(120);
    expect(h.done).toBe(true);
    expect(r.alpha).toBe(0);
  });
  it('reduced: static ring with label', () => {
    const rt = createRuntime({ reduced: true });
    const r = a();
    const seen: boolean[] = [];
    const h = waitingRing(rt, r, { onStaticLabel: (s) => seen.push(s) });
    rt.step(2000);
    expect(r.alpha).toBe(0.6);
    expect(r.scaleX).toBe(1);
    expect(seen).toEqual([true]);
    h.stop();
    expect(seen).toEqual([true, false]);
  });
});

describe('ringToCheck (row 11)', () => {
  it('reveals in 200 ms monotonic and swaps the lock at 50%', () => {
    const rt = createRuntime();
    const ring = a();
    let p = 0;
    const check = Object.assign(a(), {
      setReveal(v: number) {
        p = v;
      },
    });
    const frames: number[] = [];
    ringToCheck(rt, { ring, check, lock: { setFrame: (i) => frames.push(i), openFrame: 3 } });
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      rt.step(19.9);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(p).toBeLessThan(1);
    rt.step(5);
    expect(p).toBe(1);
    expect(frames[0]).toBe(3);
    expect(ring.alpha).toBe(0);
  });
  it('reduced: instant swap', () => {
    const rt = createRuntime({ reduced: true });
    let p = 0;
    let f = -1;
    const check = Object.assign(a(), {
      setReveal(v: number) {
        p = v;
      },
    });
    const h = ringToCheck(rt, {
      ring: a(),
      check,
      lock: { setFrame: (i) => (f = i), openFrame: 2 },
    });
    expect(h.done).toBe(true);
    expect(p).toBe(1);
    expect(f).toBe(2);
  });
  it('confirmTick draws then completes', () => {
    const rt = createRuntime();
    let p = 0;
    confirmTick(
      rt,
      Object.assign(a(), {
        setReveal(v: number) {
          p = v;
        },
      }),
    );
    rt.step(200);
    expect(p).toBe(1);
  });
});

describe('ambient loops (rows 5, 13)', () => {
  it('litWindow stays within .85..1 and is steady when reduced', () => {
    const rt = createRuntime();
    const w = a();
    litWindow(rt, w);
    for (let i = 0; i < 300; i++) {
      rt.step(20);
      expect(w.alpha).toBeGreaterThanOrEqual(0.85 - 1e-9);
      expect(w.alpha).toBeLessThanOrEqual(1 + 1e-9);
    }
    const rt2 = createRuntime({ calm: true });
    const w2 = a();
    w2.alpha = 0.3;
    litWindow(rt2, w2);
    rt2.step(2000);
    expect(w2.alpha).toBe(1);
  });
  it('lantern cycles three frames in 2 s, steady red when reduced', () => {
    const rt = createRuntime();
    const frames = new Set<number>();
    lanternFlicker(rt, Object.assign(a(), { setFrame: (i: number) => frames.add(i) }));
    for (let i = 0; i < 100; i++) rt.step(20);
    expect([...frames].sort()).toEqual([0, 1, 2]);
    const rt2 = createRuntime({ reduced: true });
    const f2: number[] = [];
    lanternFlicker(rt2, Object.assign(a(), { setFrame: (i: number) => f2.push(i) }));
    rt2.step(3000);
    expect(new Set(f2)).toEqual(new Set([0]));
  });
  it('flash rate stays under 3 per second (lantern: one cycle per 2 s)', () => {
    const rt = createRuntime();
    let flips = 0;
    let last = -1;
    lanternFlicker(
      rt,
      Object.assign(a(), {
        setFrame: (i: number) => {
          if (i !== last) flips++;
          last = i;
        },
      }),
    );
    for (let i = 0; i < 50; i++) rt.step(20); // 1 s
    expect(flips).toBeLessThanOrEqual(3);
  });
});

describe('speaking (row 17)', () => {
  it('bobs by whole pixels at 8 fps, glow follows amplitude, returns to rest', () => {
    const rt = createRuntime();
    const sprite = Object.assign(a(), {
      frame: 0,
      setFrame(i: number) {
        this.frame = i;
      },
    });
    sprite.y = 50;
    const glow = a();
    glow.alpha = 0;
    const h = speaking(rt, { sprite, glow });
    h.setSpeaking(true);
    h.setAmplitude(1);
    const ys = new Set<number>();
    for (let i = 0; i < 60; i++) {
      rt.step(1000 / 60);
      ys.add(sprite.y);
    }
    expect([...ys].sort()).toEqual([48, 50]);
    expect(glow.alpha).toBeGreaterThan(0.9);
    h.setSpeaking(false);
    for (let i = 0; i < 60; i++) rt.step(1000 / 60);
    expect(sprite.y).toBe(50);
    expect(glow.alpha).toBeLessThan(0.05);
  });
  it('reduced: glow only, no bob, no frame swap', () => {
    const rt = createRuntime({ reduced: true });
    const frames: number[] = [];
    const sprite = Object.assign(a(), { setFrame: (i: number) => frames.push(i) });
    sprite.y = 10;
    const glow = a();
    const h = speaking(rt, { sprite, glow });
    h.setSpeaking(true);
    h.setAmplitude(0.8);
    rt.step(500);
    rt.step(500);
    expect(sprite.y).toBe(10);
    expect(frames.length).toBe(0);
    expect(glow.alpha).toBeGreaterThan(0.5);
  });
  it('smoothAmplitude converges and never overshoots', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) {
      v = smoothAmplitude(v, 1, 16);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(v).toBeGreaterThan(0.99);
    expect(smoothAmplitude(0.5, 0.5, 16)).toBe(0.5);
  });
});

describe('ambient world (rows 1, 2)', () => {
  it('parallax layers follow camera by factor', () => {
    const l = [
      { scrollFactor: 0.1, tile: { tilePositionX: 0 } },
      { scrollFactor: 0.6, tile: { tilePositionX: 0 } },
    ];
    parallaxStep(l, 1000);
    expect(l[0]?.tile.tilePositionX).toBe(100);
    expect(l[1]?.tile.tilePositionX).toBe(600);
  });
  it('clouds drift 1 px/s linear; reduced stops', () => {
    const rt = createRuntime();
    const c = { tilePositionX: 0 };
    cloudDrift(rt, c);
    rt.step(10000);
    expect(c.tilePositionX).toBe(10);
    const rt2 = createRuntime({ reduced: true });
    const c2 = { tilePositionX: 0 };
    cloudDrift(rt2, c2);
    rt2.step(10000);
    expect(c2.tilePositionX).toBe(0);
  });
  it('dayNight is 20 s, and 200 ms when reduced, ends exactly at target', () => {
    const rt = createRuntime();
    const log: number[] = [];
    const h = dayNight(rt, { setTint: (v) => log.push(v) }, { from: 0xffffff, to: 0x203060 });
    rt.step(19999);
    expect(h.done).toBe(false);
    rt.step(1);
    expect(h.done).toBe(true);
    expect(log.at(-1)).toBe(0x203060);
    const rt2 = createRuntime({ reduced: true });
    const h2 = dayNight(rt2, { setTint: () => {} }, { from: 0, to: 1 });
    rt2.step(200);
    expect(h2.done).toBe(true);
  });
});

describe('camera and buildings (rows 14, 15)', () => {
  it('pan is 400 ms ease-in-out, whole pixels, skippable', () => {
    const rt = createRuntime();
    const cam = { scrollX: 0, scrollY: 0 };
    const h = cameraPan(rt, cam, { x: 300, y: 0 });
    rt.step(200);
    expect(cam.scrollX).toBe(Math.round(300 * easeInOut(0.5)));
    expect(Number.isInteger(cam.scrollX)).toBe(true);
    h.skip();
    expect(cam.scrollX).toBe(300);
    expect(h.done).toBe(true);
  });
  it('reduced: jump cut', () => {
    const rt = createRuntime({ reduced: true });
    const cam = { scrollX: 0, scrollY: 0 };
    expect(cameraPan(rt, cam, { x: 300, y: 9 }).done).toBe(true);
    expect(cam).toEqual({ scrollX: 300, scrollY: 9 });
  });
  it('building transition: 200 ms total, midpoint at full cover; 120 ms reduced', () => {
    for (const [reduced, total] of [
      [false, 200],
      [true, 120],
    ] as const) {
      const rt = createRuntime({ reduced });
      const o = a();
      let mid = -1;
      const h = buildingTransition(rt, {
        direction: 'enter',
        overlay: o,
        onMidpoint: () => (mid = o.alpha),
      });
      rt.step(total / 2);
      expect(mid).toBe(1);
      rt.step(total / 2 - 1);
      expect(h.done).toBe(false);
      rt.step(2);
      expect(h.done).toBe(true);
      expect(o.alpha).toBe(0);
    }
  });
});

describe('cutscene (row 20)', () => {
  it('runs steps in order and fires onDone once', () => {
    const rt = createRuntime();
    const order: string[] = [];
    let done = 0;
    const x = a();
    cutscene(rt)
      .step('one', (r) => {
        order.push('one');
        return r.tween(x, { x: 10 }, { duration: 100 });
      })
      .wait(50)
      .step('two', (r) => {
        order.push('two');
        return r.tween(x, { y: 10 }, { duration: 100 });
      })
      .play({ onDone: () => done++ });
    rt.step(0);
    rt.step(100);
    rt.step(1);
    expect(order).toEqual(['one']);
    rt.step(50);
    expect(order).toEqual(['one', 'two']);
    rt.step(100);
    rt.step(1);
    expect(done).toBe(1);
    expect(x).toMatchObject({ x: 10, y: 10 });
  });
  it('skip reaches end states and fires onSkip, not onDone', () => {
    const rt = createRuntime();
    const x = a();
    let skip = 0;
    let done = 0;
    const h = cutscene(rt)
      .step('a', (r) => r.tween(x, { x: 5 }, { duration: 1000 }))
      .step('b', (r) => r.tween(x, { y: 7 }, { duration: 1000 }))
      .play({ onSkip: () => skip++, onDone: () => done++ });
    rt.step(10);
    h.skip();
    expect(x).toMatchObject({ x: 5, y: 7 });
    expect([skip, done]).toEqual([1, 0]);
    h.skip();
    expect(skip).toBe(1);
  });
  it('any key skips via skipOnKey', () => {
    const rt = createRuntime();
    const x = a();
    const et = new EventTarget();
    const h = cutscene(rt)
      .step('a', (r) => r.tween(x, { x: 5 }, { duration: 1000 }))
      .play();
    const detach = h.skipOnKey(et);
    rt.step(10);
    et.dispatchEvent(new Event('keydown'));
    expect(h.done).toBe(true);
    expect(x.x).toBe(5);
    detach();
  });
  it('trip: road scroll 2.4 s then door pop 0.5 s; skippable; reduced shows card', () => {
    const rt = createRuntime();
    const road = { tilePositionX: 0 };
    const vehicle = a();
    const door = a();
    door.alpha = 0;
    const h = tripCutscene(rt, { road, vehicle, tripDoor: door });
    rt.step(0);
    expect(h.currentStep).toBe('drive');
    rt.step(2399);
    expect(h.currentStep).toBe('drive');
    expect(door.alpha).toBe(0);
    rt.step(2);
    rt.step(0);
    expect(h.currentStep).toBe('door');
    rt.step(520);
    rt.step(1);
    expect(h.done).toBe(true);
    expect(door.scaleX).toBe(1);
    const rt2 = createRuntime({ reduced: true });
    const card = a();
    const door2 = a();
    door2.alpha = 0;
    const road2 = { tilePositionX: 0 };
    const h2 = tripCutscene(rt2, { road: road2, vehicle: a(), tripDoor: door2, card });
    rt2.step(0);
    rt2.step(200);
    rt2.step(1);
    expect(h2.done).toBe(true);
    expect(road2.tilePositionX).toBe(0);
    expect(card.alpha).toBe(1);
    expect(door2.alpha).toBe(1);
  });
});
