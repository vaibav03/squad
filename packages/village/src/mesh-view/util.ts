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
  o: { ms: number; ease?: Ease; delay?: number; onUpdate?: () => void; onComplete?: () => void; repeat?: number; yoyo?: boolean },
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
