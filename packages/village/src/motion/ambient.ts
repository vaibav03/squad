import { easeInOut, lerpColor } from './curves';
import { DURATION } from './tokens';
import { doneHandle, type MotionRuntime } from './runtime';
import type { MotionHandle } from './types';

/** Row 1 (pure). Layers follow the camera at their own factor (0.1 far to 0.6 near). */
export function parallaxStep(
  layers: Array<{ scrollFactor: number; tile: { tilePositionX: number } }>,
  cameraScrollX: number,
): void {
  for (const l of layers) l.tile.tilePositionX = Math.round(cameraScrollX * l.scrollFactor);
}

/** Row 1. Linear drift, 1 px/s. Reduced/Calm: no drift. */
export function cloudDrift(
  rt: MotionRuntime,
  cloud: { tilePositionX: number },
  o: { pxPerSec?: number } = {},
): MotionHandle {
  if (rt.reduced) return doneHandle();
  const speed = o.pxPerSec ?? 1;
  const base = cloud.tilePositionX;
  let travelled = 0;
  return rt.spawn({
    update: (dt) => {
      travelled += (speed * dt) / 1000;
      cloud.tilePositionX = base + Math.round(travelled);
      return false;
    },
  });
}

/** Row 2. 20 s ease-in-out tint tween at dusk/dawn only. Reduced: 200 ms fade snap. */
export function dayNight(
  rt: MotionRuntime,
  tint: { setTint(rgb: number): void },
  o: { from: number; to: number; at?: 'dusk' | 'dawn' },
): MotionHandle {
  const dur = rt.reduced ? DURATION.dayNightReduced : DURATION.dayNight;
  let elapsed = 0;
  tint.setTint(o.from);
  return rt.spawn({
    update: (dt) => {
      elapsed += dt;
      if (elapsed >= dur) {
        tint.setTint(o.to);
        return true;
      }
      tint.setTint(lerpColor(o.from, o.to, easeInOut(elapsed / dur)));
      return false;
    },
    finish: () => tint.setTint(o.to),
  });
}
