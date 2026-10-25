import { describe, expect, it } from 'vitest';
import { chairmanVerdict, councilOpinions, councilRank } from './council';
import { createRuntime } from './runtime';
import type { Animatable } from './types';

const mk = (x = 0, y = 0): Animatable => ({ x, y, alpha: 1, scaleX: 1, scaleY: 1 });

describe('councilOpinions', () => {
  it('staggers 80 ms, each 160 ms ease-out, scale from .95, independent', () => {
    const rt = createRuntime();
    const bs = [mk(), mk(), mk()];
    const h = councilOpinions(rt, bs);
    expect(bs.map((b) => b.alpha)).toEqual([0, 0, 0]);
    rt.step(40);
    expect(bs[0]!.alpha).toBeGreaterThan(0);
    expect(bs[1]!.alpha).toBe(0);
    expect(bs[0]!.scaleX).toBeLessThan(1);
    rt.step(40); // 80: second starts
    rt.step(1);
    expect(bs[1]!.alpha).toBeGreaterThan(0);
    expect(bs[2]!.alpha).toBe(0);
    rt.step(79); // 160
    expect(bs[0]!.alpha).toBe(1);
    expect(bs[1]!.alpha).toBeLessThan(1);
    rt.step(160);
    expect(h.done).toBe(true);
    expect(bs.map((b) => [b.alpha, b.scaleX, b.scaleY])).toEqual([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);
  });

  it('cancel stops all; skip finishes all', () => {
    const rt = createRuntime();
    const a = [mk(), mk()];
    const h = councilOpinions(rt, a);
    rt.step(100);
    h.skip();
    expect(a.map((b) => b.alpha)).toEqual([1, 1]);
    expect(h.done).toBe(true);
    const b = [mk(), mk()];
    const h2 = councilOpinions(rt, b);
    rt.step(100);
    const snap = b.map((x) => x.alpha);
    h2.cancel();
    rt.step(500);
    expect(b.map((x) => x.alpha)).toEqual(snap);
  });

  it('reduced: bubbles fade in order, no scale', () => {
    const rt = createRuntime({ reduced: true });
    const bs = [mk(), mk(), mk()];
    councilOpinions(rt, bs);
    rt.step(100);
    expect(bs[0]!.alpha).toBeGreaterThan(bs[1]!.alpha);
    expect(bs[1]!.alpha).toBeGreaterThan(bs[2]!.alpha);
    expect(bs.every((b) => b.scaleX === 1 && b.scaleY === 1)).toBe(true);
    rt.step(400);
    expect(bs.map((b) => b.alpha)).toEqual([1, 1, 1]);
  });

  it('empty list is already done', () => {
    const rt = createRuntime();
    expect(councilOpinions(rt, []).done).toBe(true);
  });
});

describe('councilRank', () => {
  it('slides 320 ms ease-in-out to slots, whole pixels', () => {
    const rt = createRuntime();
    const bs = [mk(0, 0), mk(0, 50)];
    const h = councilRank(rt, [
      { bubble: bs[0]!, to: { x: 100, y: 10 } },
      { bubble: bs[1]!, to: { x: 200, y: 0 } },
    ]);
    rt.step(160);
    expect(bs[0]!.x).toBeGreaterThan(30);
    expect(bs[0]!.x).toBeLessThan(70);
    expect(Number.isInteger(bs[1]!.x) && Number.isInteger(bs[1]!.y)).toBe(true);
    rt.step(159);
    expect(h.done).toBe(false);
    rt.step(1);
    expect(bs.map((b) => [b.x, b.y])).toEqual([
      [100, 10],
      [200, 0],
    ]);
    expect(h.done).toBe(true);
  });

  it('reduced: fade in order, snapping to slots', () => {
    const rt = createRuntime({ reduced: true });
    const bs = [mk(), mk()];
    const h = councilRank(rt, [
      { bubble: bs[0]!, to: { x: 100, y: 0 } },
      { bubble: bs[1]!, to: { x: 200, y: 0 } },
    ]);
    rt.step(60);
    expect([bs[0]!.x, bs[1]!.x]).toEqual([100, 0]); // second still waiting its 80 ms turn
    rt.step(20);
    rt.step(60);
    expect([bs[0]!.x, bs[1]!.x]).toEqual([100, 200]);
    rt.step(100);
    expect([bs[0]!.alpha, bs[1]!.alpha, h.done]).toEqual([1, 1, true]);
  });

  it('skip lands everything; cancel does not', () => {
    const rt = createRuntime();
    const b = mk();
    const h = councilRank(rt, [{ bubble: b, to: { x: 100, y: 0 } }]);
    rt.step(50);
    h.skip();
    expect(b.x).toBe(100);
    const c = mk();
    const h2 = councilRank(rt, [{ bubble: c, to: { x: 100, y: 0 } }]);
    rt.step(50);
    const x = c.x;
    h2.cancel();
    rt.step(500);
    expect(c.x).toBe(x);
  });
});

describe('chairmanVerdict', () => {
  it('240 ms ease-out from .95', () => {
    const rt = createRuntime();
    const b = mk();
    const h = chairmanVerdict(rt, b);
    expect([b.alpha, b.scaleX]).toEqual([0, 0.95]);
    rt.step(120);
    expect(b.alpha).toBeGreaterThan(0.8);
    rt.step(119);
    expect(h.done).toBe(false);
    rt.step(1);
    expect([b.alpha, b.scaleX, h.done]).toEqual([1, 1, true]);
  });
  it('reduced: alpha only over 240 ms', () => {
    const rt = createRuntime({ reduced: true });
    const b = mk();
    chairmanVerdict(rt, b);
    rt.step(100);
    expect(b.scaleX).toBe(1);
    expect(b.alpha).toBeGreaterThan(0);
    rt.step(140);
    expect(b.alpha).toBe(1);
  });
});
