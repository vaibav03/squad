// TODO(shared): dedupe into @squad/world-shared (source: ws/village-world packages/village/src/boot/scaler.ts; this copy drops the 270px height cap)
export interface ScaleResult {
  /** Art zoom: 3 at css width >= 900 else 2 (docs/design/DESIGN.md 2.2), reduced only if the height cannot fit. */
  zoom: number;
  /** Device pixels per art pixel (integer). */
  k: number;
  /** CSS px per art pixel (may be fractional at DPR 1.25/1.5 but device-aligned). */
  cssPerPx: number;
  logicalW: number;
  logicalH: number;
  cssW: number;
  cssH: number;
}

/** Below this many native rows we drop a zoom step rather than crop the room. */
const MIN_VIEW_H = 168;

/**
 * Integer art scaling only. `k = max(zoom, round(zoom * dpr))` is an integer so every art pixel covers a
 * whole number of device pixels. The canvas buffer is native size; CSS shows it at k/dpr per art pixel.
 */
export function computeScale(
  containerW: number,
  containerH: number,
  dpr = 1,
  extraZoom = 0,
): ScaleResult {
  const cw = Math.max(1, containerW);
  const ch = Math.max(1, containerH);
  let zoom = cw >= 900 ? 3 : 2;
  while (zoom > 1 && Math.floor(ch / zoom) < MIN_VIEW_H) zoom--;
  zoom += extraZoom;
  const k = Math.max(zoom, Math.round(zoom * dpr));
  const cssPerPx = k / dpr;
  const logicalW = Math.max(64, Math.floor(cw / cssPerPx));
  const logicalH = Math.max(64, Math.floor(ch / cssPerPx));
  return {
    zoom,
    k,
    cssPerPx,
    logicalW,
    logicalH,
    cssW: logicalW * cssPerPx,
    cssH: logicalH * cssPerPx,
  };
}
