import { LOGICAL_H } from '../world/api';

export interface ScaleResult {
  zoom: number; // integer css px per logical px
  logicalW: number;
  logicalH: number;
  cssW: number; // canvas css size, always an integer multiple of logical size
  cssH: number;
  offsetX: number; // letterbox offsets inside the container (css px)
  offsetY: number;
}

/** Narrowest logical width we accept before dropping a zoom step (phones: 390 css px -> 2x -> 195 logical). */
export const MIN_LOGICAL_W = 180;
export const MAX_LOGICAL_W = 480;

/**
 * Integer scaling only. The canvas buffer is the logical size; CSS shows it at `zoom` css px per logical px
 * with `image-rendering: pixelated`. We prefer a zoom for which `zoom * dpr` is an integer (so every logical
 * pixel covers a whole number of device pixels: 2x at DPR 2/3, 4x at DPR 1.5 ...), but never drop more than
 * one step below the largest zoom that fits.
 */
export function computeScale(containerW: number, containerH: number, dpr = 1): ScaleResult {
  const cw = Math.max(1, Math.floor(containerW));
  const ch = Math.max(1, Math.floor(containerH));
  const fitByH = Math.floor(ch / LOGICAL_H);
  const fitByW = Math.floor(cw / MIN_LOGICAL_W);
  const zmax = Math.max(1, Math.min(fitByH, fitByW));
  const isWhole = (z: number) => Math.abs(z * dpr - Math.round(z * dpr)) < 1e-6;
  let zoom = zmax;
  for (const z of [zmax, zmax - 1]) {
    if (z >= 1 && isWhole(z)) {
      zoom = z;
      break;
    }
  }
  const logicalW = Math.min(MAX_LOGICAL_W, Math.max(1, Math.floor(cw / zoom)));
  const logicalH = LOGICAL_H;
  const cssW = logicalW * zoom;
  const cssH = logicalH * zoom;
  return { zoom, logicalW, logicalH, cssW, cssH, offsetX: Math.floor((cw - cssW) / 2), offsetY: Math.max(0, Math.floor((ch - cssH) / 2)) };
}
