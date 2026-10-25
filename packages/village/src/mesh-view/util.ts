import type Phaser from 'phaser';
import type { VillageContext } from '../world/api';
import { FONT_STACK, PAL } from './palette';
import type { PalKey } from './palette';

export type Ease = (t: number) => number;
export const snap = (n: number): number => Math.round(n);

/** Tween helper: everything the mesh view animates goes through here (transform/alpha only). */
export function tween(
  ctx: VillageContext,
  targets: object | object[],
  props: Record<string, number>,
  o: {
    ms: number;
    ease?: Ease;
    delay?: number;
    onUpdate?: () => void;
    onComplete?: () => void;
    repeat?: number;
    yoyo?: boolean;
  },
): Phaser.Tweens.Tween {
  return ctx.scene.tweens.add({
    targets,
    ...props,
    duration: o.ms,
    ease: o.ease ?? ctx.motion.easeOut,
    delay: o.delay ?? 0,
    repeat: o.repeat ?? 0,
    yoyo: o.yoyo ?? false,
    onUpdate: o.onUpdate,
    onComplete: o.onComplete,
  });
}

export function pixelText(
  ctx: VillageContext,
  text: string,
  o: { color?: PalKey; wrap?: number; align?: 'left' | 'center'; size?: number } = {},
): Phaser.GameObjects.Text {
  const t = ctx.scene.add.text(0, 0, text, {
    fontFamily: FONT_STACK,
    fontSize: `${o.size ?? 8}px`,
    color: PAL[o.color ?? 'ink'],
    lineSpacing: 1,
    align: o.align ?? 'left',
    ...(o.wrap ? { wordWrap: { width: o.wrap, useAdvancedWrap: true } } : {}),
  });
  t.setOrigin(0, 0);
  t.setResolution(1);
  return t;
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export const BUBBLE_MAX_CHARS = 60;
export const BUBBLE_MAX_LINES = 3;

/** Displayed bubble body: at most 60 characters over at most 3 lines (DESIGN 8.10); the rest lives in the DOM feed. */
export function bubbleBody(text: string, lines: readonly string[] = [], bullets = true): string {
  const parts = [
    clip(text, BUBBLE_MAX_CHARS),
    ...lines.map((l) => (bullets ? `- ${clip(l, BUBBLE_MAX_CHARS)}` : clip(l, BUBBLE_MAX_CHARS))),
  ].slice(0, BUBBLE_MAX_LINES);
  return clip(parts.join('\n'), BUBBLE_MAX_CHARS);
}

/**
 * Stagger row for a hand-off starting at `now`: how many hand-offs started within the last `windowMs`.
 * Records `now` in `starts` (and drops expired entries).
 */
export function nextStagger(starts: number[], now: number, windowMs = 400): number {
  while (starts.length && now - starts[0]! > windowMs) starts.shift();
  const idx = starts.length;
  starts.push(now);
  return idx;
}
