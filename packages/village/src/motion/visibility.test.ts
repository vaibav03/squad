import { describe, expect, it } from 'vitest';
import { createRuntime } from './runtime';
import { pauseWhenHidden, pauseWhenHiddenWith } from './visibility';
import type { Animatable } from './types';

function fakeDoc(): { doc: Document; set(h: boolean): void; listeners: number } {
  const ls = new Set<() => void>();
  const state = { hidden: false };
  const doc = {
    get hidden() {
      return state.hidden;
    },
    addEventListener: (_: string, fn: () => void) => void ls.add(fn),
    removeEventListener: (_: string, fn: () => void) => void ls.delete(fn),
  } as unknown as Document;
  return {
    doc,
    set(h) {
      state.hidden = h;
      [...ls].forEach((f) => f());
    },
    get listeners() {
      return ls.size;
    },
  };
}
const a = (): Animatable => ({ x: 0, y: 0, alpha: 1, scaleX: 1, scaleY: 1 });

describe('tab visibility pause', () => {
  it('pauses while hidden and resumes without catching up', () => {
    const rt = createRuntime();
    const d = fakeDoc();
    const detach = pauseWhenHidden(rt, d.doc);
    const t = a();
    rt.tween(t, { x: 1000 }, { duration: 1000, curve: (x) => x });
    rt.update(50);
    expect(t.x).toBe(50);
    d.set(true);
    expect(rt.paused).toBe(true);
    rt.update(50);
    expect(t.x).toBe(50);
    d.set(false);
    expect(rt.paused).toBe(false);
    rt.update(100); // first frame after resume is the large gap: dropped
    expect(t.x).toBe(50);
    rt.update(16);
    expect(t.x).toBe(66);
    detach();
    expect(d.listeners).toBe(0);
  });
  it('calls hide/show callbacks (Phaser loop sleep/wake)', () => {
    const rt = createRuntime();
    const d = fakeDoc();
    const log: string[] = [];
    pauseWhenHiddenWith({
      runtime: rt,
      doc: d.doc,
      onHide: () => log.push('hide'),
      onShow: () => log.push('show'),
    });
    d.set(true);
    d.set(false);
    d.set(false);
    expect(log).toEqual(['hide', 'show']);
  });
  it('a tab that starts hidden is paused immediately', () => {
    const rt = createRuntime();
    const d = fakeDoc();
    d.set(true);
    pauseWhenHidden(rt, d.doc);
    expect(rt.paused).toBe(true);
  });
});
