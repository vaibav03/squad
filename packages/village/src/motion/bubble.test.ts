import { describe, expect, it } from 'vitest';
import { showBubble } from './bubble';
import { easeOut } from './curves';
import { createRuntime } from './runtime';
import { bubbleHoldMs } from './tokens';
import type { Animatable } from './types';

const mk = (): Animatable => ({ x: 7, y: 9, alpha: 1, scaleX: 1, scaleY: 1 });

describe('showBubble', () => {
  it('frame 1 is alpha 0 at .95, 160 ms ease-out in, then whole', () => {
    const rt = createRuntime();
    const b = mk();
    showBubble(rt, b, { text: 'hello' });
    expect([b.alpha, b.scaleX, b.scaleY]).toEqual([0, 0.95, 0.95]);
    rt.step(80);
    const c = easeOut(0.5);
    expect(b.alpha).toBeCloseTo(c, 6);
    expect(b.scaleX).toBeCloseTo(0.95 + 0.05 * c, 6);
    expect(b.alpha).toBeGreaterThan(0.5); // ease-out front-loaded
    rt.step(80);
    expect([b.alpha, b.scaleX, b.scaleY]).toEqual([1, 1, 1]);
    expect([b.x, b.y]).toEqual([7, 9]); // origin never moves
  });

  it('holds bubbleHoldMs(text) then exits 120 ms and calls onGone', () => {
    const rt = createRuntime();
    const b = mk();
    let gone = 0;
    const text = 'x'.repeat(40); // 2400 ms
    const h = showBubble(rt, b, { text, onGone: () => gone++ });
    expect(bubbleHoldMs(text)).toBe(2400);
    rt.step(160 + 2399);
    expect(b.alpha).toBe(1);
    rt.step(1);
    expect(b.alpha).toBe(1);
    rt.step(60);
    expect(b.alpha).toBeGreaterThan(0);
    expect(b.alpha).toBeLessThan(0.5); // ease-out exit is front-loaded
    expect(h.done).toBe(false);
    rt.step(60);
    expect([b.alpha, h.done, gone]).toEqual([0, true, 1]);
  });

  it('min hold 1200 ms for short text; explicit holdMs wins', () => {
    const rt = createRuntime();
    const a = mk();
    showBubble(rt, a, { text: 'hi' });
    rt.step(160 + 1199);
    expect(a.alpha).toBe(1);
    const rt2 = createRuntime();
    const b = mk();
    showBubble(rt2, b, { text: 'x'.repeat(100), holdMs: 100 });
    rt2.step(160 + 100 + 120);
    expect(b.alpha).toBe(0);
  });

  it('thought and speech have identical motion', () => {
    const run = (kind: 'speech' | 'thought'): number[] => {
      const rt = createRuntime();
      const b = mk();
      showBubble(rt, b, { text: 'abc', kind });
      const out: number[] = [];
      for (let i = 0; i < 40; i++) {
        rt.step(50);
        out.push(b.alpha, b.scaleX);
      }
      return out;
    };
    expect(run('thought')).toEqual(run('speech'));
  });

  it('dismiss() before hold ends starts the 120 ms exit immediately', () => {
    const rt = createRuntime();
    const b = mk();
    let gone = 0;
    const h = showBubble(rt, b, { text: 'x'.repeat(100), onGone: () => gone++ });
    rt.step(500);
    h.dismiss();
    h.dismiss(); // idempotent
    rt.step(119);
    expect(h.done).toBe(false);
    rt.step(1);
    expect([b.alpha, h.done, gone]).toEqual([0, true, 1]);
  });

  it('dismiss() mid-entrance exits from the current pose', () => {
    const rt = createRuntime();
    const b = mk();
    const h = showBubble(rt, b, { text: 'abc' });
    rt.step(40);
    const a = b.alpha;
    h.dismiss();
    rt.step(1);
    expect(b.alpha).toBeLessThan(a);
    rt.step(119);
    expect([b.alpha, h.done]).toEqual([0, true]);
  });

  it('skip jumps to gone and fires onGone; cancel leaves pose and no onGone', () => {
    const rt = createRuntime();
    const b = mk();
    let gone = 0;
    const h = showBubble(rt, b, { text: 'abc', onGone: () => gone++ });
    rt.step(300);
    h.skip();
    expect([b.alpha, h.done, gone]).toEqual([0, true, 1]);
    const b2 = mk();
    const h2 = showBubble(rt, b2, { text: 'abc', onGone: () => gone++ });
    rt.step(300);
    h2.cancel();
    rt.step(5000);
    expect([b2.alpha, h2.done, gone]).toEqual([1, true, 1]);
  });

  it('reduced: alpha fade only, scale stays 1 throughout', () => {
    const rt = createRuntime({ reduced: true });
    const b = mk();
    b.scaleX = 3;
    const h = showBubble(rt, b, { text: 'hi' });
    expect([b.alpha, b.scaleX, b.scaleY]).toEqual([0, 1, 1]);
    for (let t = 0; t < 1600; t += 20) {
      rt.step(20);
      expect([b.scaleX, b.scaleY]).toEqual([1, 1]);
    }
    expect(h.done).toBe(true);
    expect(b.alpha).toBe(0);
  });

  it('finished resolves when the bubble is gone', async () => {
    const rt = createRuntime();
    const h = showBubble(rt, mk(), { holdMs: 10 });
    rt.step(1000);
    await expect(h.finished).resolves.toBeUndefined();
  });
});
