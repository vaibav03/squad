/** The only three curves (plus linear and the rare-delight spring). No ease-in exists. */
export type Curve = (t: number) => number;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** CSS-compatible cubic-bezier solver. Endpoints are exact: f(0)=0, f(1)=1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Curve {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number): number => ((ay * s + by) * s + cy) * s;
  const sampleDX = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;

  const solveX = (x: number): number => {
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-7) return s;
      const d = sampleDX(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(s);
      if (Math.abs(v - x) < 1e-7) return s;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return s;
  };

  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

/**
 * Rare-delight spring (Framer-style duration/bounce). Time is normalised to 0..1 of the
 * configured duration; overshoot is bounded by `bounce`. Exact endpoints: 0 -> 0, 1 -> 1.
 */
export function spring(opts: { duration?: number; bounce?: number } = {}): Curve {
  const bounce = Math.min(0.9, Math.max(0, opts.bounce ?? 0.2));
  // damping ratio from bounce (bounce 0 = critically damped); a few oscillations inside the window.
  const zeta = 1 - bounce;
  const omega = 2 * Math.PI * (1.5 + bounce * 2); // cycles over the normalised window
  const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const decay = zeta * omega;
  const raw = (t: number): number =>
    1 - Math.exp(-decay * t) * (Math.cos(wd * t) + (decay / wd) * Math.sin(wd * t));
  const end = raw(1);
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // blend the residual so the curve lands exactly on 1 at t=1
    return raw(t) + (1 - end) * t * t * t;
  };
}

/**
 * Pop for rare-delight entrances: scale goes `from` (0.9) up to `peak` (~1.05) and settles on 1.
 * Use as the curve of a tween from `from` to 1: value = from + (1 - from) * curve(t).
 * The shape is the spring above (bounce within 0.1-0.3); only the overshoot part is scaled so the
 * peak lands on `peak`. Endpoints are exact.
 */
export function popCurve(o: { from?: number; peak?: number; bounce?: number } = {}): Curve {
  const from = o.from ?? 0.9;
  const peak = o.peak ?? 1.05;
  const bounce = Math.min(0.3, Math.max(0.1, o.bounce ?? 0.3));
  const base = spring({ bounce });
  let m = 1;
  for (let i = 0; i <= 1000; i++) m = Math.max(m, base(i / 1000));
  const target = 1 + (peak - 1) / (1 - from); // curve value that yields `peak`
  const gain = m > 1 ? (target - 1) / (m - 1) : 1;
  return (t: number): number => {
    const v = base(t);
    return v <= 1 ? v : 1 + (v - 1) * gain;
  };
}

export const linear: Curve = (t) => clamp01(t);
export const easeOut: Curve = cubicBezier(0.23, 1, 0.32, 1);
export const easeInOut: Curve = cubicBezier(0.77, 0, 0.175, 1);
export const easeDrawer: Curve = cubicBezier(0.32, 0.72, 0, 1);

export const CURVES = { linear, easeOut, easeInOut, easeDrawer } as const;

/** Same values as the CSS custom properties in packages/web/src/motion/motion.css. */
export const CSS_VARS = {
  '--ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
  '--ease-in-out': 'cubic-bezier(0.77, 0, 0.175, 1)',
  '--ease-drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpColor(a: number, b: number, t: number): number {
  const c = clamp01(t);
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, c));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, c));
  const bl = Math.round(lerp(a & 255, b & 255, c));
  return (r << 16) | (g << 8) | bl;
}
