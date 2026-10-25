import type { Rect } from '../tilemap/types';
import { TILE } from '../tilemap/types';

export interface View {
  w: number;
  h: number;
}
export interface Vec2 {
  x: number;
  y: number;
}

/** One axis: clamp the view into [min,max]; centre it when the region is smaller than the view. */
export function fitAxis(target: number, view: number, min: number, max: number): number {
  const len = max - min;
  if (len <= view) return Math.round(min + (len - view) / 2);
  return Math.round(Math.min(Math.max(target - view / 2, min), max - view));
}

/** Follow camera: centre on the target, clamped to the map (map centred if smaller than the view). */
export function followScroll(target: Vec2, view: View, mapPx: View): Vec2 {
  return {
    x: fitAxis(target.x, view.w, 0, mapPx.w),
    y: fitAxis(target.y, view.h, 0, mapPx.h),
  };
}

/** A room's camera frame: its floor plus the wall above (2 tiles) and a 1 tile skirt on the other sides. */
export function roomFrame(bounds: Rect, mapPx: View): Rect {
  const x0 = Math.max(0, bounds.x - TILE);
  const y0 = Math.max(0, bounds.y - 2 * TILE);
  const x1 = Math.min(mapPx.w, bounds.x + bounds.w + TILE);
  const y1 = Math.min(mapPx.h, bounds.y + bounds.h + TILE);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Room-snap camera: stays inside the room frame, follows the target if the frame is larger than the view. */
export function roomScroll(target: Vec2, view: View, frame: Rect, mapPx?: View): Vec2 {
  const s = {
    x: fitAxis(target.x, view.w, frame.x, frame.x + frame.w),
    y: fitAxis(target.y, view.h, frame.y, frame.y + frame.h),
  };
  if (!mapPx) return s;
  // Never show void beyond the map edge when the map itself is larger than the view.
  return {
    x: mapPx.w > view.w ? Math.min(Math.max(s.x, 0), mapPx.w - view.w) : s.x,
    y: mapPx.h > view.h ? Math.min(Math.max(s.y, 0), mapPx.h - view.h) : s.y,
  };
}

/** Linear blend between two scroll positions with an externally eased t; whole pixels. */
export function lerpScroll(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) };
}
