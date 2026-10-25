import { CURVES, popCurve } from './curves';
import { loopJob, type RingHandle } from './loop';
import { doneHandle, type MotionRuntime } from './runtime';
import { CONFLICT_TINT, DURATION } from './tokens';
import type { Animatable, MotionHandle, Revealable } from './types';

export type { RingHandle } from './loop';

/** Row 9. One spring pop (0.35 s, bounce 0.2), red tint holds, no shake. Reduced: static marker. */
export function conflictMarker(
  rt: MotionRuntime,
  marker: Animatable & { setTint?(rgb: number): void },
  o: { tint?: number } = {},
): MotionHandle {
  marker.setTint?.(o.tint ?? CONFLICT_TINT);
  marker.visible = true;
  if (rt.reduced) {
    marker.alpha = 1;
    marker.scaleX = 1;
    marker.scaleY = 1;
    return doneHandle();
  }
  return rt.tween(
    marker,
    { alpha: 1, scale: 1 },
    {
      duration: DURATION.conflictPop,
      curve: popCurve({ from: 0.9, peak: 1.05, bounce: 0.2 }),
      from: { alpha: 0, scale: 0.9 },
    },
  );
}

/** Row 10. Scale 1 -> 1.15, alpha .6 -> 0, 1.6 s ease-out loop. Reduced: static ring + label. */
export function waitingRing(
  rt: MotionRuntime,
  ring: Animatable,
  o: { onStaticLabel?: (show: boolean) => void } = {},
): RingHandle {
  const rest = (): void => {
    ring.scaleX = 1;
    ring.scaleY = 1;
    ring.alpha = 0;
    o.onStaticLabel?.(false);
  };
  if (rt.reduced) {
    ring.scaleX = 1;
    ring.scaleY = 1;
    ring.alpha = 0.6;
    o.onStaticLabel?.(true);
    return loopJob(rt, {
      periodMs: DURATION.ringLoop,
      apply: () => {},
      rest,
      fade: (p) => {
        ring.alpha = 0.6 * (1 - p);
      },
    });
  }
  let a0 = 0.6;
  return loopJob(rt, {
    periodMs: DURATION.ringLoop,
    apply: (phase) => {
      const c = CURVES.easeOut(phase);
      ring.scaleX = ring.scaleY = 1 + 0.15 * c;
      a0 = 0.6 * (1 - c);
      ring.alpha = a0;
    },
    rest,
    fade: (p) => {
      ring.alpha = a0 * (1 - p);
    },
  });
}

/** Row 11. 200 ms ease-out check reveal; lock frame swaps at 50%. Reduced: instant swap. */
export function ringToCheck(
  rt: MotionRuntime,
  o: {
    ring: Animatable;
    check: Revealable & Animatable;
    lock?: { setFrame(i: number): void; openFrame: number };
  },
): MotionHandle {
  const end = (): void => {
    o.ring.alpha = 0;
    o.check.alpha = 1;
    o.check.visible = true;
    o.check.setReveal(1);
    o.lock?.setFrame(o.lock.openFrame);
  };
  if (rt.reduced) {
    end();
    return doneHandle();
  }
  let swapped = false;
  o.check.alpha = 1;
  o.check.visible = true;
  o.check.setReveal(0);
  const dummy = { x: 0, y: 0, alpha: 0, scaleX: 1, scaleY: 1 };
  return rt.tween(
    dummy,
    { alpha: 1 },
    {
      duration: DURATION.checkReveal,
      curve: CURVES.easeOut,
      onUpdate: (t) => {
        const c = CURVES.easeOut(t);
        o.check.setReveal(c);
        o.ring.alpha = Math.min(o.ring.alpha, 1 - c);
        if (!swapped && t >= 0.5) {
          swapped = true;
          o.lock?.setFrame(o.lock.openFrame);
        }
      },
      onComplete: end,
    },
  );
}

/** confirm.done: a small tick, drawn by mask in 200 ms ease-out. Reduced: instant. */
export function confirmTick(rt: MotionRuntime, tick: Animatable & Revealable): MotionHandle {
  tick.visible = true;
  tick.alpha = 1;
  if (rt.reduced) {
    tick.setReveal(1);
    return doneHandle();
  }
  tick.setReveal(0);
  const d = { x: 0, y: 0, alpha: 0, scaleX: 1, scaleY: 1 };
  return rt.tween(
    d,
    { alpha: 1 },
    {
      duration: DURATION.checkReveal,
      curve: CURVES.easeOut,
      onUpdate: (t) => tick.setReveal(CURVES.easeOut(t)),
      onComplete: () => tick.setReveal(1),
    },
  );
}

/** Row 13. Three frames over 2 s with eased alpha. Reduced: steady red lantern. */
export function lanternFlicker(
  rt: MotionRuntime,
  lantern: Animatable & { setFrame?(i: number): void },
): RingHandle {
  const steady = (): void => {
    lantern.alpha = 1;
    lantern.setFrame?.(0);
  };
  if (rt.reduced) {
    steady();
    return loopJob(rt, { periodMs: DURATION.lanternLoop, apply: () => {}, rest: steady });
  }
  return loopJob(rt, {
    periodMs: DURATION.lanternLoop,
    apply: (phase) => {
      lantern.setFrame?.(Math.min(2, Math.floor(phase * 3)));
      const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      lantern.alpha = 0.85 + 0.15 * CURVES.easeInOut(tri);
    },
    rest: steady,
  });
}

/** Row 5. Alpha .85 <-> 1 over a 4 s loop, ease-in-out. Reduced: steady lit. */
export function litWindow(rt: MotionRuntime, win: Animatable): RingHandle {
  const steady = (): void => {
    win.alpha = 1;
  };
  if (rt.reduced) {
    steady();
    return loopJob(rt, { periodMs: DURATION.litWindowLoop, apply: () => {}, rest: steady });
  }
  return loopJob(rt, {
    periodMs: DURATION.litWindowLoop,
    apply: (phase) => {
      const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
      win.alpha = 0.85 + 0.15 * CURVES.easeInOut(tri);
    },
    rest: steady,
  });
}
