import { easeInOut, easeOut } from './curves';
import { allHandles, type MotionRuntime } from './runtime';
import { DURATION } from './tokens';
import { teleport, walkTo } from './walk';
import type { EnvelopeTarget, MotionHandle, Point, Walker } from './types';

const DEFAULT_CARRY: Point = { x: 0, y: -12 };

function popIn(rt: MotionRuntime, env: EnvelopeTarget, reduced: boolean): MotionHandle {
  if (reduced) {
    env.scaleX = 1;
    env.scaleY = 1;
    env.alpha = 0;
    return rt.tween(env, { alpha: 1 }, { duration: DURATION.envelopePop, curve: easeOut });
  }
  env.alpha = 0;
  env.scaleX = 0.95;
  env.scaleY = 0.95;
  return rt.tween(
    env,
    { alpha: 1, scale: 1 },
    { duration: DURATION.envelopePop, curve: easeOut, from: { alpha: 0, scale: 0.95 } },
  );
}

/**
 * Row 7. Envelope pops in 180 ms ease-out at the door and rides above the walker, who
 * walks linear (see walkTo). Reduced: the walker teleports and the envelope fades in at
 * the destination as the walker lands.
 */
export function carryEnvelope(
  rt: MotionRuntime,
  o: {
    walker: Walker;
    envelope: EnvelopeTarget;
    from: Point;
    to: Point;
    carryOffset?: Point;
    speedPxPerSec?: number;
    onArrive?: () => void;
  },
): MotionHandle {
  const off = o.carryOffset ?? DEFAULT_CARRY;
  const env = o.envelope;
  const dest: Point = { x: Math.round(o.to.x + off.x), y: Math.round(o.to.y + off.y) };

  if (rt.reduced) {
    env.x = dest.x;
    env.y = dest.y;
    env.scaleX = 1;
    env.scaleY = 1;
    env.alpha = 0;
    const walk = walkTo(rt, o.walker, o.to, { onArrive: o.onArrive });
    // fades in during the walker's 60 ms fade-in half
    const fade = rt.tween(
      env,
      { alpha: 1 },
      { duration: DURATION.teleportFade / 2, delay: DURATION.teleportFade / 2, curve: easeOut },
    );
    return allHandles([walk, fade]);
  }

  env.x = Math.round(o.from.x + off.x);
  env.y = Math.round(o.from.y + off.y);
  const walk = walkTo(rt, o.walker, o.to, { speedPxPerSec: o.speedPxPerSec, onArrive: o.onArrive });
  const pop = popIn(rt, env, false);
  const follow = rt.spawn({
    update: () => {
      env.x = Math.round(o.walker.x + off.x);
      env.y = Math.round(o.walker.y + off.y);
      return walk.done;
    },
    finish: () => {
      env.x = dest.x;
      env.y = dest.y;
    },
  });
  return allHandles([walk, pop, follow]);
}

/**
 * Row 7. 320 ms ease-in-out glide, +60 ms per stagger index. Reduced: fade out at `from`,
 * fade in at `to` (same stagger delay).
 */
export function handOff(
  rt: MotionRuntime,
  o: {
    envelope: EnvelopeTarget;
    from: Point;
    to: Point;
    staggerIndex?: number;
    onDone?: () => void;
  },
): MotionHandle {
  const env = o.envelope;
  const delay = DURATION.envelopeStagger * (o.staggerIndex ?? 0);
  env.x = Math.round(o.from.x);
  env.y = Math.round(o.from.y);
  if (rt.reduced) {
    return teleport(rt, env, o.to, { delay, onDone: o.onDone });
  }
  return rt.tween(
    env,
    { x: o.to.x, y: o.to.y },
    { duration: DURATION.handoff, curve: easeInOut, delay, onComplete: o.onDone },
  );
}

/** Row 7. To-commons messages: the envelope pops in at the campfire, 180 ms (alpha only when reduced). */
export function pinAtFire(rt: MotionRuntime, env: EnvelopeTarget, at: Point): MotionHandle {
  env.x = Math.round(at.x);
  env.y = Math.round(at.y);
  return popIn(rt, env, rt.reduced);
}
