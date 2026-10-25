import { easeOut, lerp } from './curves';
import type { MotionRuntime } from './runtime';
import { bubbleHoldMs, DURATION } from './tokens';
import type { BubbleTarget, MotionHandle } from './types';

export interface BubbleHandle extends MotionHandle {
  /** Start the 120 ms ease-out exit now (no-op if already exiting or gone). */
  dismiss(): void;
}

const FROM_SCALE = 0.95;

/**
 * Rows 8, 12, 17. In 160 ms ease-out (scale .95 -> 1 + alpha 0 -> 1, about the tail
 * origin), hold, auto-exit 120 ms ease-out. Speech and thought are identical. Reduced:
 * alpha only, scale stays 1. Text is never animated. The hold starts once the bubble is in.
 */
export function showBubble(
  rt: MotionRuntime,
  b: BubbleTarget,
  o: { text?: string; holdMs?: number; kind?: 'speech' | 'thought'; onGone?: () => void } = {},
): BubbleHandle {
  const reduced = rt.reduced;
  const hold = Math.max(o.holdMs ?? 0, bubbleHoldMs(o.text ?? '')); // words never leave early
  const inMs = DURATION.bubbleIn;
  const outMs = DURATION.bubbleOut;
  type Phase = 'in' | 'hold' | 'out';
  let phase: Phase = 'in';
  let t = 0;
  let a0 = 0;
  let s0 = 1;
  let gone = false;

  b.alpha = 0;
  b.scaleX = reduced ? 1 : FROM_SCALE;
  b.scaleY = reduced ? 1 : FROM_SCALE;
  const set = (alpha: number, scale: number): void => {
    b.alpha = alpha;
    if (!reduced) {
      b.scaleX = scale;
      b.scaleY = scale;
    }
  };
  const startExit = (): void => {
    phase = 'out';
    a0 = b.alpha;
    s0 = b.scaleX;
  };
  const gonePose = (): void => {
    b.alpha = 0;
    if (!reduced) {
      b.scaleX = FROM_SCALE;
      b.scaleY = FROM_SCALE;
    }
  };
  const finishGone = (): void => {
    if (gone) return;
    gone = true;
    gonePose();
    o.onGone?.();
  };

  const h = rt.spawn({
    update: (dt) => {
      t += dt;
      if (phase === 'in') {
        if (t < inMs) {
          const c = easeOut(t / inMs);
          set(c, lerp(FROM_SCALE, 1, c));
          return false;
        }
        set(1, 1);
        t -= inMs;
        phase = 'hold';
      }
      if (phase === 'hold') {
        if (t < hold) return false;
        t -= hold;
        startExit();
      }
      if (t < outMs) {
        const c = easeOut(t / outMs);
        set(lerp(a0, 0, c), lerp(s0, FROM_SCALE, c));
        return false;
      }
      finishGone();
      return true;
    },
    finish: finishGone,
  });

  return {
    get done() {
      return h.done;
    },
    finished: h.finished,
    cancel: () => h.cancel(),
    skip: () => h.skip(),
    dismiss: () => {
      if (h.done || phase === 'out') return;
      t = 0;
      startExit();
    },
  };
}
