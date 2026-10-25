import { LOGICAL_H } from '../world/api';

export interface ScaleResult {
  zoom: number; // art zoom: 3 at css width >= 900, else 2 (docs/design/DESIGN.md 2.2), reduced only if the height cannot fit
  k: number; // device pixels per art pixel (integer)
  cssPerPx: number; // k / dpr: css px per art pixel (may be fractional at DPR 1.25/1.5, but device-aligned)
  logicalW: number; // native view width in art pixels
  logicalH: number; // native view height, <= 270 (bottom-anchored camera shows the lower part)
  cssW: number;
  cssH: number;
}

const MIN_VIEW_H = 168; // below this we drop a zoom step rather than crop the sky further

/**
 * Integer art scaling only. Device pixels per art pixel `k = max(zoom, round(zoom * dpr))` is an integer, so
 * every art pixel covers a whole number of device pixels (no shimmering rows at DPR 1.25/1.5/1.75). The canvas buffer
 * is the native size; CSS shows it at k/dpr css px per art pixel with image-rendering: pixelated.
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
  zoom += extraZoom; // the HUD Zoom button: one integer step closer (3x -> 4x), never a fractional camera zoom
  const k = Math.max(zoom, Math.round(zoom * dpr));
  const cssPerPx = k / dpr;
  const logicalW = Math.max(64, Math.floor(cw / cssPerPx));
  const logicalH = Math.max(64, Math.min(LOGICAL_H, Math.floor(ch / cssPerPx)));
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
