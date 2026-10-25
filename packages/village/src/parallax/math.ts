import type { TimeMode } from '../world/api';

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Target nightness 0..1 for a fixed mode, or from the clock for 'auto'. */
export function targetNightness(mode: TimeMode, hours: number): number {
  switch (mode) {
    case 'night':
      return 1;
    case 'day':
      return 0;
    case 'dusk':
      return 0.62;
    case 'dawn':
      return 0.4;
    case 'auto': {
      const h = ((hours % 24) + 24) % 24;
      if (h >= 21 || h < 5) return 1;
      if (h >= 8 && h < 17) return 0;
      if (h >= 17 && h < 21) return clamp01((h - 17) / 4);
      return clamp01(1 - (h - 5) / 3); // 5..8 dawn
    }
  }
}

export function modeClockHours(mode: TimeMode, realHours: number): number {
  switch (mode) {
    case 'night':
      return 22.17;
    case 'dusk':
      return 19.33;
    case 'dawn':
      return 5.83;
    case 'day':
      return 13;
    case 'auto':
      return realHours;
  }
}

/** x of a TileSprite texture for a layer with scrollFactor f at camera scrollX (whole pixels, wraps by tile width). */
export function tileOffset(scrollX: number, factor: number, drift = 0, tileW = 320): number {
  const v = Math.round(scrollX * factor + drift);
  return ((v % tileW) + tileW) % tileW;
}

/** Slow sine twinkle in [lo, 1]. */
export function twinkle(timeMs: number, periodMs: number, lo = 0.82, phase = 0): number {
  const s = 0.5 + 0.5 * Math.sin((timeMs / periodMs) * Math.PI * 2 + phase);
  return lo + (1 - lo) * s;
}

/** Window flicker 0.85..1 on a 4 s loop, ease-in-out shaped (triangle through smoothstep). */
export function flicker(timeMs: number, phase = 0): number {
  const p = (((timeMs / 4000 + phase) % 1) + 1) % 1;
  const tri = p < 0.5 ? p * 2 : (1 - p) * 2;
  const e = tri * tri * (3 - 2 * tri);
  return 0.85 + 0.15 * e;
}

/**
 * Parallax props appear to stand at world x = layerX + (1 - factor) * scrollX. A windmill is only drawn where that spot
 * is clear of every building footprint (plus its sail radius), fading in over 48 px, so sails never cross a roof.
 */
export function clearance(
  worldX: number,
  slots: ReadonlyArray<{ x: number; w: number; kind: string }>,
): number {
  let best = Infinity;
  for (const s of slots) {
    if (s.kind === 'spawn' || s.kind === 'road') continue;
    best = Math.min(best, Math.abs(worldX - s.x) - s.w / 2);
  }
  return best;
}
export function millAlpha(
  worldX: number,
  slots: ReadonlyArray<{ x: number; w: number; kind: string }>,
  sailRadius = 36,
): number {
  return clamp01((clearance(worldX, slots) - sailRadius) / 48);
}

/** World x a parallax prop appears to stand at: layerX + (1 - factor) * scrollX. */
export const parallaxWorldX = (layerX: number, scrollX: number, factor: number) =>
  layerX + (1 - factor) * scrollX;
