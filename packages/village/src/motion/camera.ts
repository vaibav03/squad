import { easeInOut, easeOut } from './curves';
import { doneHandle, type MotionRuntime } from './runtime';
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
  let elapsed = 0;
  let mid = false;
  o.overlay.alpha = 0;
  o.overlay.visible = true;
  const fireMid = (): void => {
    if (mid) return;
    mid = true;
    o.onMidpoint?.();
  };
  const end = (): void => {
    o.overlay.alpha = 0;
    o.overlay.visible = false;
  };
  return rt.spawn({
    update: (dt) => {
      elapsed += dt;
      if (elapsed >= total) {
        fireMid();
        end();
        return true;
      }
      if (elapsed < half) {
        o.overlay.alpha = easeOut(elapsed / half);
      } else {
        o.overlay.alpha = 1;
        fireMid();
        o.overlay.alpha = 1 - easeOut((elapsed - half) / half);
      }
      return false;
    },
    finish: () => {
      o.overlay.alpha = 1;
      fireMid();
      end();
    },
  });
}
