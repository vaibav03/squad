import { DURATION } from './tokens';
import { easeOut } from './curves';
import type { MotionRuntime } from './runtime';
import type { Animatable, MotionHandle } from './types';

export function fadeIn(rt: MotionRuntime, t: Animatable, ms: number = DURATION.buildingFade): MotionHandle {
  return rt.tween(t, { alpha: 1 }, { duration: ms, curve: easeOut });
}
export function fadeOut(rt: MotionRuntime, t: Animatable, ms: number = DURATION.buildingFade): MotionHandle {
  return rt.tween(t, { alpha: 0 }, { duration: ms, curve: easeOut });
}
/** Scale .95 -> 1 plus alpha, never from 0. Reduced: alpha only. */
export function enter(
  rt: MotionRuntime,
  t: Animatable,
  o: { ms?: number; originFrom?: number } = {},
): MotionHandle {
  const ms = o.ms ?? DURATION.bubbleIn;
  if (rt.reduced) {
    t.scaleX = 1;
    t.scaleY = 1;
    t.alpha = 0;
    return rt.tween(t, { alpha: 1 }, { duration: ms, curve: easeOut });
  }
  const s = o.originFrom ?? 0.95;
  return rt.tween(t, { alpha: 1, scale: 1 }, { duration: ms, curve: easeOut, from: { alpha: 0, scale: s } });
}
