import { loopJob } from './loop';
import { SPEAK_BOB_PX, SPEAK_FPS } from './tokens';
import type { MotionRuntime } from './runtime';
import type { Animatable, MotionHandle } from './types';

export interface SpeakingTarget {
  sprite: Animatable & { setFrame?(i: number): void };
  glow?: Animatable;
  portrait?: Animatable;
}
export interface SpeakingHandle extends MotionHandle {
  setSpeaking(on: boolean): void;
  /** 0..1, smoothed; drives glow alpha only. */
  setAmplitude(a: number): void;
}

const TAU_MS = 80;

/** Pure exponential smoothing, tau 80 ms. */
export function smoothAmplitude(prev: number, next: number, dtMs: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / TAU_MS);
  return prev + (next - prev) * k;
}

/**
 * Row 17. 2-frame swap at 8 fps, 2 px bob, glow opacity follows smoothed amplitude.
 * Reduced: glow only (no bob, no frame swap).
 */
export function speaking(rt: MotionRuntime, t: SpeakingTarget): SpeakingHandle {
  const baseY = t.sprite.y;
  const portraitBaseY = t.portrait?.y ?? 0;
  let on = false;
  let target = 0;
  let amp = 0;
  let elapsed = 0;
  let last = rt.now;
  const rest = (): void => {
    t.sprite.y = baseY;
    t.sprite.setFrame?.(0);
    if (t.portrait) t.portrait.y = portraitBaseY;
    if (t.glow) t.glow.alpha = 0;
  };
  const h = loopJob(rt, {
    periodMs: 1000,
    rest,
    apply: () => {
      const dt = Math.max(0, rt.now - last);
      last = rt.now;
      amp = smoothAmplitude(amp, on ? target : 0, dt);
      if (t.glow) t.glow.alpha = amp;
      if (!on) {
        t.sprite.y = baseY;
        if (!rt.reduced) t.sprite.setFrame?.(0);
        return;
      }
      if (rt.reduced) return;
      elapsed += dt;
      const frame = Math.floor((elapsed / 1000) * SPEAK_FPS) % 2;
      t.sprite.setFrame?.(frame);
      t.sprite.y = baseY - (frame === 1 ? SPEAK_BOB_PX : 0);
      if (t.portrait) t.portrait.y = portraitBaseY - (frame === 1 ? SPEAK_BOB_PX : 0);
    },
  });
  return {
    get done() {
      return h.done;
    },
    finished: h.finished,
    cancel: () => h.cancel(),
    skip: () => h.skip(),
    setSpeaking(v) {
      on = v;
      if (v && target === 0) target = 0.6;
    },
    setAmplitude(a) {
      target = Math.min(1, Math.max(0, a));
    },
  };
}
