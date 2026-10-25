/** Centre x the camera may take so the visible window (worldW visible = viewW / zoom) stays inside the world. */
export function clampCenter(center: number, viewW: number, zoom: number, worldW: number): number {
  const half = viewW / zoom / 2;
  if (half * 2 >= worldW) return worldW / 2;
  return Math.min(worldW - half, Math.max(half, center));
}
/** scrollX (whole px) that puts `center` in the middle of a viewW-wide camera. Phaser scroll is zoom-independent. */
export const scrollForCenter = (center: number, viewW: number) => Math.round(center - viewW / 2);
export const BLEND_MS = 400; // spec 08 row 14
/** Blend progress 0..1 and eased value from elapsed ms. */
export function blend(elapsed: number, ease: (t: number) => number, ms = BLEND_MS): number {
  return ease(Math.min(1, Math.max(0, elapsed / ms)));
}
