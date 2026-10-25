import { describe, expect, it } from 'vitest';
import { LabRunner } from './engine';
import { renderStage, textWidth, type Ctx2D } from './renderer';
import { SCENES } from './scenes';

type Call = { fn: string; args: unknown[] };
function fakeCtx(): { ctx: Ctx2D; calls: Call[]; state: { smoothing: boolean | null } } {
  const calls: Call[] = [];
  const state = { smoothing: null as boolean | null };
  const rec =
    (fn: string) =>
    (...args: unknown[]): void => {
      calls.push({ fn, args });
    };
  const ctx = {
    fillStyle: '#000',
    globalAlpha: 1,
    set imageSmoothingEnabled(v: boolean) {
      state.smoothing = v;
    },
    get imageSmoothingEnabled() {
      return state.smoothing ?? true;
    },
    save: rec('save'),
    restore: rec('restore'),
    translate: rec('translate'),
    scale: rec('scale'),
    setTransform: rec('setTransform'),
    fillRect: rec('fillRect'),
  } as unknown as Ctx2D;
  return { ctx, calls, state };
}

describe('renderer headless smoke', () => {
  it('renders every scene at several moments with finite, integer coordinates', () => {
    for (const reduced of [false, true]) {
      for (const s of SCENES) {
        const r = new LabRunner(s.id);
        r.setReduced(reduced);
        for (const pct of [0, 25, 50, 75, 100]) {
          r.seekPct(pct);
          const { ctx, calls, state } = fakeCtx();
          renderStage(ctx, r.stage, 3);
          expect(state.smoothing).toBe(false);
          expect(calls.some((c) => c.fn === 'fillRect')).toBe(true);
          let saves = 0;
          for (const c of calls) {
            for (const a of c.args) expect(Number.isFinite(a as number)).toBe(true);
            if (c.fn === 'save') saves++;
            if (c.fn === 'restore') saves--;
            if (c.fn === 'fillRect' || c.fn === 'translate') {
              expect(Number.isInteger(c.args[0])).toBe(true);
              expect(Number.isInteger(c.args[1])).toBe(true);
            }
            if (c.fn === 'fillRect') {
              expect(Number.isInteger(c.args[2])).toBe(true);
              expect(Number.isInteger(c.args[3])).toBe(true);
            }
          }
          expect(saves).toBe(0);
        }
      }
    }
  });

  it('uses an integer pixel scale', () => {
    const r = new LabRunner('m3');
    const { ctx, calls } = fakeCtx();
    renderStage(ctx, r.stage, 2.7);
    const t = calls.find((c) => c.fn === 'setTransform')!;
    expect(t.args[0]).toBe(2);
    expect(t.args[3]).toBe(2);
  });

  it('draws whole-pixel text (1x1 rects) for bubbles', () => {
    const r = new LabRunner('m8');
    r.seekPct(50);
    const { ctx, calls } = fakeCtx();
    renderStage(ctx, r.stage, 1);
    expect(
      calls.filter((c) => c.fn === 'fillRect' && c.args[2] === 1 && c.args[3] === 1).length,
    ).toBeGreaterThan(20);
    expect(textWidth('AB')).toBe(7);
  });
});
