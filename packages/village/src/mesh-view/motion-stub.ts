/**
 * Local stand-in for packages/village/src/motion (owned by the motion workstream, docs/motion-api.md).
 * Same three curves as docs/specs/08-village-motion.md; swap this import for the real module when it lands.
 */
export type Ease = (t: number) => number;

/** CSS-style cubic-bezier(x1,y1,x2,y2) solved with Newton + bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0,
      hi = 1;
    t = x;
    while (lo < hi) {
      const e = sx(t);
      if (Math.abs(e - x) < 1e-6) break;
      if (x > e) lo = t;
      else hi = t;
      t = (hi - lo) / 2 + lo;
      if (hi - lo < 1e-7) break;
    }
    return sy(t);
  };
}

export const easeOut: Ease = cubicBezier(0.23, 1, 0.32, 1);
export const easeInOut: Ease = cubicBezier(0.77, 0, 0.175, 1);
export const easeDrawer: Ease = cubicBezier(0.32, 0.72, 0, 1);
export const linear: Ease = (t) => t;
/** Rare delight only: spring { duration 0.5, bounce 0.2 }, underdamped, settles at 1. */
export const spring: Ease = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const zeta = 0.8; // bounce 0.2
  const wd = Math.PI * 2 * 2 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * 2 * Math.PI * 2 * t * 0.5) * Math.cos(wd * t * 0.5);
};
