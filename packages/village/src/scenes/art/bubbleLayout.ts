import type { Raster } from '../pixel/raster';
import type { BubbleStyle } from '../contract';
import { bubble, BUBBLE_LINES, type BubbleArt } from './bubble';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Test hook: when `on`, `blitBubble` records the rect of every bubble it draws (alpha > 5%). */
export const bubbleTrace: { on: boolean; rects: Array<Rect & { key: string }> } = {
  on: false,
  rects: [],
};

export function blitBubble(
  r: Raster,
  art: Raster,
  x: number,
  y: number,
  alpha: number,
  key = '',
): void {
  if (bubbleTrace.on && alpha > 0.05) bubbleTrace.rects.push({ x, y, w: art.w, h: art.h, key });
  r.blit(art, x, y, { alpha });
}

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const GAP = 4;
const MARGIN = 2;

/** Characters per line so `n` bubbles fit side by side in a row `width` px wide (3 lines, max 30). */
export function rowChars(n: number, width: number): number {
  if (n <= 1) return 30;
  const each = (width - 2 * MARGIN - GAP * (n - 1)) / n;
  return Math.max(8, Math.min(30, Math.floor((each - 5) / 4)));
}

export interface RowItem {
  /** Where the speaker is (tail target) along x. */
  cx: number;
  text: string;
  style: BubbleStyle;
  /** false for ranked bubbles (no tail). */
  tail: boolean;
}
export interface RowPlaced {
  x: number;
  y: number;
  art: BubbleArt;
}

/**
 * One row of bubbles with their bottoms on `tipY`: widths shrink so they all fit, then each sits
 * under its speaker, pushed apart left to right so no two ever touch. Pure.
 */
export function placeRow(items: readonly RowItem[], width: number, tipY: number): RowPlaced[] {
  const n = items.length;
  const chars = rowChars(n, width);
  const first = items.map((it) =>
    bubble(it.text, it.style, chars, BUBBLE_LINES, it.tail ? 0.5 : null),
  );
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.cx - items[b]!.cx);
  const xs: number[] = items.map((it, i) =>
    Math.max(
      MARGIN,
      Math.min(width - MARGIN - first[i]!.r.w, Math.round(it.cx - first[i]!.r.w / 2)),
    ),
  );
  let edge = -Infinity;
  for (const i of order) {
    xs[i] = Math.max(xs[i]!, edge === -Infinity ? MARGIN : edge + GAP);
    edge = xs[i]! + first[i]!.r.w;
  }
  let limit = width - MARGIN;
  for (const i of [...order].reverse()) {
    xs[i] = Math.min(xs[i]!, limit - first[i]!.r.w);
    limit = xs[i]! - GAP;
  }
  return items.map((it, i) => {
    const w = first[i]!.r.w;
    const tf = Math.round(Math.max(0.15, Math.min(0.85, (it.cx - xs[i]!) / w)) * 20) / 20;
    const art = it.tail ? bubble(it.text, it.style, chars, BUBBLE_LINES, tf) : first[i]!;
    const y = it.tail ? tipY - art.tail.y : tipY - 2 - art.r.h;
    return { x: xs[i]!, y, art };
  });
}
