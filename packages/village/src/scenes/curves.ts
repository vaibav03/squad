/**
 * The three motion curves of docs/specs/08-village-motion.md. Local mirror of the motion
 * workstream's `motion.ts` (M-1) so scene painters stay pure; swap the import when it lands.
 * Same values as the CSS custom properties. No other curves; never ease-in.
 */
export type Curve = (t: number) => number;

function cubicBezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sy = (s: number) => ((ay * s + by) * s + cy) * s;
  const dx = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(s) - x;
      if (Math.abs(e) < 1e-6) return sy(s);
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= e / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 24; i++) {
      const e = sx(s);
      if (Math.abs(e - x) < 1e-6) break;
      if (e < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sy(s);
  };
}

export const easeOut: Curve = cubicBezier(0.23, 1, 0.32, 1);
export const easeInOut: Curve = cubicBezier(0.77, 0, 0.175, 1);
export const easeDrawer: Curve = cubicBezier(0.32, 0.72, 0.0, 1);

/** Progress 0..1 of a timed motion that began at `since`, at time `now`. */
export function progress(now: number, since: number, durationMs: number, delayMs = 0): number {
  return Math.min(1, Math.max(0, (now - since - delayMs) / durationMs));
}

/** Words never move for style: minimum bubble hold is 1.2 s per 20 characters (08). */
export function minHoldMs(text: string): number {
  return Math.max(1200, Math.ceil(text.length / 20) * 1200);
}
