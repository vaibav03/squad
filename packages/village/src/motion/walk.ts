import { easeOut } from './curves';
import { doneHandle, type MotionRuntime } from './runtime';
import { DEFAULT_WALK_SPEED, DURATION, WALK_FPS } from './tokens';
import type { Animatable, MotionHandle, Point, Walker } from './types';

const HALF_TELEPORT = DURATION.teleportFade / 2; // 60 ms out + 60 ms in

/**
 * Reduced-motion move: fade out 60 ms, snap to the whole-pixel target, fade in 60 ms.
 * `delay` holds the target untouched first (used for ordered fades). skip() lands at the
 * target fully visible; cancel() leaves the target where it is.
 */
export function teleport(
  rt: MotionRuntime,
  t: Animatable,
  to: Point,
  o: { delay?: number; onDone?: () => void } = {},
): MotionHandle {
  const delay = o.delay ?? 0;
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  let elapsed = 0;
  let a0 = -1;
  let snapped = false;
  const land = (): void => {
    t.x = tx;
    t.y = ty;
    snapped = true;
  };
  const end = (): void => {
    if (a0 < 0) a0 = t.alpha > 0 ? t.alpha : 1;
    land();
    t.alpha = a0;
    o.onDone?.();
  };
  return rt.spawn({
    update: (dt) => {
      elapsed += dt;
      if (elapsed < delay) return false;
      if (a0 < 0) a0 = t.alpha > 0 ? t.alpha : 1;
      const e = elapsed - delay;
      if (e >= DURATION.teleportFade) {
        end();
        return true;
      }
      if (e < HALF_TELEPORT) {
        t.alpha = a0 * (1 - easeOut(e / HALF_TELEPORT));
      } else {
        if (!snapped) {
          land();
          t.alpha = 0;
        }
        t.alpha = a0 * easeOut((e - HALF_TELEPORT) / HALF_TELEPORT);
      }
      return false;
    },
    finish: end,
  });
}

/** Walk frame for an elapsed time: 4-frame cycle at 8 fps (0..3). */
export function walkFrame(elapsedMs: number): 0 | 1 | 2 | 3 {
  const i = Math.floor((Math.max(0, elapsedMs) * WALK_FPS) / 1000) % 4;
  return i as 0 | 1 | 2 | 3;
}

function facingFor(dx: number, dy: number): 'left' | 'right' | 'up' | 'down' {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'up' : 'down';
}

/**
 * Row 3. Linear constant speed, instant start, whole pixels, 80 ms ease-out stop over the
 * last stretch, 4-frame cycle at 8 fps (idleFrame on stop). Never accelerates.
 * Reduced/Calm: fade out 60 ms, snap to target, fade in 60 ms, no frames.
 */
const activeWalks = new WeakMap<object, MotionHandle>();

/** A new walkTo on the same walker cancels the previous one (no two tweens fighting). */
export function walkTo(
  rt: MotionRuntime,
  who: Walker,
  to: Point,
  o: { speedPxPerSec?: number; onArrive?: () => void; idleFrame?: number } = {},
): MotionHandle {
  const prev = activeWalks.get(who);
  if (prev && !prev.done) prev.cancel();
  const h = startWalk(rt, who, to, o);
  activeWalks.set(who, h);
  return h;
}

function startWalk(
  rt: MotionRuntime,
  who: Walker,
  to: Point,
  o: { speedPxPerSec?: number; onArrive?: () => void; idleFrame?: number } = {},
): MotionHandle {
  const idle = o.idleFrame ?? 0;
  const tx = Math.round(to.x);
  const ty = Math.round(to.y);
  const sx = who.x;
  const sy = who.y;
  const dx = tx - sx;
  const dy = ty - sy;
  const d = Math.hypot(dx, dy);
  if (d === 0) {
    who.setFrame?.(idle);
    o.onArrive?.();
    return doneHandle();
  }
  if (rt.reduced) {
    return teleport(rt, who, { x: tx, y: ty }, { onDone: o.onArrive });
  }
  const v = Math.max(1, o.speedPxPerSec ?? DEFAULT_WALK_SPEED);
  const stop = DURATION.stopWalk;
  const tc = Math.max(0, (d / v) * 1000 - stop); // constant-speed section, ms
  const covered = (v * tc) / 1000;
  const total = tc + stop;
  let elapsed = 0;
  let lastFrame = -1;
  who.setFacing?.(facingFor(dx, dy));
  const place = (dist: number): void => {
    const k = dist / d;
    who.x = Math.round(sx + dx * k);
    who.y = Math.round(sy + dy * k);
  };
  const frame = (): void => {
    const f = walkFrame(elapsed);
    if (f !== lastFrame) {
      lastFrame = f;
      who.setFrame?.(f);
    }
  };
  const arrive = (): void => {
    who.x = tx;
    who.y = ty;
    who.setFrame?.(idle);
    o.onArrive?.();
  };
  frame();
  return rt.spawn({
    update: (dt) => {
      elapsed += dt;
      if (elapsed >= total) {
        arrive();
        return true;
      }
      if (elapsed <= tc) place((v * elapsed) / 1000);
      else place(covered + (d - covered) * easeOut((elapsed - tc) / stop));
      frame();
      return false;
    },
    finish: arrive,
  });
}

/**
 * Rows 4/6: looping frame animation (idle breathing 2 @ 2 fps, smoke, campfire).
 * Reduced: a single static frame. skip() stops the loop on its rest frame.
 */
export function frameLoop(
  rt: MotionRuntime,
  setFrame: (i: number) => void,
  o: { frames: number; fps: number; reducedFrame?: number },
): MotionHandle {
  const rest = o.reducedFrame ?? 0;
  if (rt.reduced || o.frames <= 1) {
    setFrame(rest);
    return doneHandle();
  }
  let elapsed = 0;
  let last = 0;
  setFrame(0);
  return rt.spawn({
    update: (dt) => {
      elapsed += dt;
      const f = Math.floor((elapsed * o.fps) / 1000) % o.frames;
      if (f !== last) {
        last = f;
        setFrame(f);
      }
      return false;
    },
    finish: () => setFrame(rest),
  });
}
