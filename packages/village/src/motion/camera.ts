import { easeInOut, easeOut } from './curves';
import { allHandles, doneHandle, type MotionRuntime } from './runtime';
import { DURATION } from './tokens';
import type { Animatable, CameraLike, MotionHandle } from './types';

/**
 * Row 14. 400 ms ease-in-out, skippable via handle.skip(). Reduced: jump cut.
 * Never call this for keyboard walking: input must have no camera lag.
 */
export function cameraPan(
  rt: MotionRuntime,
  cam: CameraLike,
  to: { x: number; y: number },
  o: { skipOn?: () => boolean; onDone?: () => void } = {},
): MotionHandle {
  const snap = (): void => {
    cam.scrollX = Math.round(to.x);
    cam.scrollY = Math.round(to.y);
  };
  if (rt.reduced) {
    snap();
    o.onDone?.();
    return doneHandle();
  }
  const sx = cam.scrollX;
  const sy = cam.scrollY;
  let elapsed = 0;
  return rt.spawn({
    update: (dt) => {
      if (o.skipOn?.()) {
        snap();
        o.onDone?.();
        return true;
      }
      elapsed += dt;
      if (elapsed >= DURATION.cameraPan) {
        snap();
        o.onDone?.();
        return true;
      }
      const c = easeInOut(elapsed / DURATION.cameraPan);
      cam.scrollX = Math.round(sx + (to.x - sx) * c);
      cam.scrollY = Math.round(sy + (to.y - sy) * c);
      return false;
    },
    finish: () => {
      snap();
      o.onDone?.();
    },
  });
}

/**
 * Row 15. Fade plane alpha 0 -> 1 (ease-out), onMidpoint fires at full cover, then 1 -> 0.
 * Total 200 ms (100 + 100) normally and 120 ms reduced (60 + 60).
 */
export function buildingTransition(
  rt: MotionRuntime,
  o: { direction: 'enter' | 'leave'; overlay: Animatable; onMidpoint?: () => void },
): MotionHandle {
  const total = rt.reduced ? DURATION.buildingFadeReduced : DURATION.buildingFade;
  const half = total / 2;
  o.overlay.alpha = 0;
  o.overlay.visible = true;
  let mid = false;
  const fireMid = (): void => {
    if (mid) return;
    mid = true;
    o.onMidpoint?.();
  };
  const cover = rt.tween(o.overlay, { alpha: 1 }, { duration: half, curve: easeOut, onComplete: fireMid });
  let uncover: MotionHandle | null = null;
  const start = (): MotionHandle => rt.tween(o.overlay, { alpha: 0 }, {
    duration: half,
    curve: easeOut,
    onComplete: () => {
      o.overlay.visible = false;
    },
  });
  // chain: begin the uncover after the cover completes
  const chain = rt.spawn({
    update: () => {
      if (!cover.done) return false;
      uncover ??= start();
      return uncover.done;
    },
    finish: () => {
      cover.skip();
      fireMid();
      uncover ??= start();
      uncover.skip();
    },
    abort: () => {
      cover.cancel();
      uncover?.cancel();
    },
  });
  return allHandles([chain]);
}
