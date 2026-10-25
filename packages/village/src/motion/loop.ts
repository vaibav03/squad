import type { MotionRuntime } from './runtime';
import type { MotionHandle } from './types';

export interface RingHandle extends MotionHandle {
  /** End the loop: fade to rest over fadeMs (default 0 = immediate rest state). */
  stop(fadeMs?: number): void;
}

/**
 * A looping job that stays not-done until stop()/cancel()/skip(). `apply(phase, cycle)` is
 * called each update with phase in [0,1). `rest()` puts the target in its resting state.
 * If `fade` is provided it is used by stop(fadeMs) with progress 0..1.
 */
export function loopJob(
  rt: MotionRuntime,
  o: {
    periodMs: number;
    apply: (phase: number, cycle: number) => void;
    rest: () => void;
    fade?: (progress: number) => void;
  },
): RingHandle {
  let elapsed = 0;
  let stopping = false;
  let fadeLeft = 0;
  let fadeTotal = 0;
  const handle = rt.spawn({
    update: (dt) => {
      if (stopping) {
        fadeLeft -= dt;
        if (fadeLeft <= 0) {
          o.rest();
          return true;
        }
        o.fade?.(1 - fadeLeft / fadeTotal);
        return false;
      }
      elapsed += dt;
      const cycle = Math.floor(elapsed / o.periodMs);
      o.apply((elapsed - cycle * o.periodMs) / o.periodMs, cycle);
      return false;
    },
    finish: o.rest,
    abort: undefined,
  });
  o.apply(0, 0);
  return {
    get done() {
      return handle.done;
    },
    finished: handle.finished,
    cancel: () => handle.cancel(),
    skip: () => handle.skip(),
    stop(fadeMs = 0) {
      if (handle.done || stopping) return;
      if (fadeMs <= 0 || !o.fade) {
        handle.skip();
        return;
      }
      stopping = true;
      fadeTotal = fadeMs;
      fadeLeft = fadeMs;
    },
  };
}
