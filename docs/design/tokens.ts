/* Squad Village design tokens (TypeScript mirror of tokens.css). Keep both files in sync; tokens.css is canonical.
   No dependencies. Intended copy target: packages/village/src/motion.ts and packages/web tokens. */

export const palette = {
  ink: '#070f1f', skyDeep: '#0b1d38', skyMid: '#0a3a63', skyLow: '#0c6e9e',
  cloudLo: '#6fa3b8', cloudHi: '#b4d6da', moon: '#fff2c4',
  hillFar: '#4a7695', hillMid: '#2f5f84', hillNear: '#1c4466', ground: '#122b3f',
  leafDark: '#0d3a4f', leafLit: '#22808a',
  wallLit: '#c9d4e4', wallMid: '#8c9bb8', wallShade: '#56648a',
  roofWine: '#7a3552', roofShade: '#4a2440',
  woodLit: '#b07a52', wood: '#6e4a3c', woodDark: '#3a2634',
  glowCore: '#fff0a8', glow: '#ffc857', ember: '#f08a3a',
  alert: '#e0485a', ok: '#5fcf8a', skinLt: '#f3cfae', violet: '#8f7bff',
} as const;
export type PaletteName = keyof typeof palette;
/** Phaser wants numbers: hexNum(palette.glow) -> 0xffc857 */
export const hexNum = (hex: string): number => parseInt(hex.slice(1), 16);
export const paletteNum = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, hexNum(v)])) as Record<PaletteName, number>;

export const chrome = {
  dark: {
    background: palette.ink, foreground: '#eef3f8', card: palette.skyDeep, popover: '#102a4a',
    primary: palette.glow, primaryForeground: palette.ink, secondary: '#12335a', muted: palette.ground,
    mutedForeground: '#8fb0c4', accent: '#174a73', border: '#1d4163', ring: palette.cloudHi,
    destructive: palette.alert, destructiveText: '#ff7d8b', success: palette.ok, warning: palette.ember, info: palette.violet,
  },
  light: {
    background: '#f4f1e8', foreground: '#0b1d38', card: '#fbf9f3', popover: '#ffffff',
    primary: '#0b1d38', primaryForeground: '#fff2c4', secondary: '#e8e6dc', muted: '#ece9de',
    mutedForeground: '#4b6275', accent: '#e0e6ea', border: '#d6d3c6', ring: '#0c6e9e',
    destructive: '#b8283c', destructiveText: '#b8283c', success: '#1d7a4b', warning: '#a24e0c', info: '#5b46d6',
  },
} as const;

export const agentState = {
  idle: palette.cloudLo, studying: palette.glow, call: palette.ok,
  waiting: palette.ember, conflict: palette.alert, offline: palette.hillMid,
} as const;

export const font = {
  sans: '"Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  pixel: '"Pixelify Sans", "Silkscreen", "NinjaAdventure", ui-monospace, monospace',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

/** DOM type scale [px size, px line-height]. */
export const text = {
  xs: [12, 16], sm: [14, 20], base: [16, 24], lg: [18, 28], xl: [22, 30], '2xl': [28, 34],
  pixelSm: [16, 16], pixelMd: [24, 24], pixelLg: [32, 32],
} as const;

export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const radius = { base: 10, sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;
export const touchMin = 44;
export const z = { canvas: 0, sceneDom: 1, hud: 10, panel: 20, dock: 20, scrim: 30, overlay: 40, toast: 50, tooltip: 60, cutsceneSkip: 70 } as const;

/** Art scale. Native art is 1x; show it at an integer zoom only. */
export const pixel = {
  tile: 16, cell: 32,
  zoomFor(cssWidth: number): 2 | 3 { return cssWidth >= 900 ? 3 : 2; },
  /** Largest integer zoom, never fractional. dpr is handled by the canvas backing store, not by the zoom. */
  snap(v: number, zoom: number): number { return Math.round(v * zoom) / zoom; },
} as const;

/* ---------- Motion ---------- */
export const duration = { press: 100, fast: 150, base: 200, panel: 280, bubble: 160, bubbleExit: 120, camera: 400, tripScroll: 2400 } as const; // ms
export type Bezier = readonly [number, number, number, number];
export const curve = {
  easeOut: [0.23, 1, 0.32, 1],
  easeInOut: [0.77, 0, 0.175, 1],
  easeDrawer: [0.32, 0.72, 0, 1],
} as const satisfies Record<string, Bezier>;
export const css = {
  easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)', easeInOut: 'cubic-bezier(0.77, 0, 0.175, 1)', easeDrawer: 'cubic-bezier(0.32, 0.72, 0, 1)',
} as const;
export const spring = { duration: 0.5, bounce: 0.2 } as const; // rare delight only

/** Solve a CSS-style cubic-bezier into f(t): [0,1] -> [0,1]. Newton + bisection, same math browsers use. Usable as a Phaser tween `ease`. */
export function bezier([x1, y1, x2, y2]: Bezier): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const Y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t: number) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) { const e = X(s) - t; if (Math.abs(e) < 1e-6) return Y(s); const d = dX(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
    let lo = 0, hi = 1; s = t;
    while (lo < hi) { const x = X(s); if (Math.abs(x - t) < 1e-6) break; if (t > x) lo = s; else hi = s; s = (hi - lo) / 2 + lo; if (hi - lo < 1e-7) break; }
    return Y(s);
  };
}
export const easeOut = bezier(curve.easeOut);
export const easeInOut = bezier(curve.easeInOut);
export const easeDrawer = bezier(curve.easeDrawer);
/** Walking stop: 80 ms ease-out, walking itself is linear (never eased). */
export const walk = { fps: 8, stopMs: 80, ease: easeOut, speedPxPerSec: 60 } as const;

/** Damped spring for rare delight (trip door pop, '!' marker). Returns f(t in seconds) -> displacement from 0 to 1 with ~bounce overshoot. */
export function springEase({ duration, bounce }: { duration: number; bounce: number } = spring): (t: number) => number {
  const w = (2 * Math.PI) / duration, z = 1 - bounce; // underdamped: smaller z = bouncier
  const wd = w * Math.sqrt(Math.max(1e-6, 1 - z * z));
  return (t01: number) => { const t = Math.min(1, Math.max(0, t01)) * duration; return t01 >= 1 ? 1 : 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); };
}

/** Reduced motion / Calm mode: pick variants. Phaser code must read this once per scene and on change. */
export const reducedMotion = {
  query: '(prefers-reduced-motion: reduce)',
  teleportFadeMs: 120, snapFadeMs: 200, bubbleFadeOnly: true, parallax: false, ambientLoops: false,
} as const;
