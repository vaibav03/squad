import { join } from 'node:path';
import { spritesDir } from '../sprites/index.js';

export const PORTRAIT_NATIVE = 38;
export const PORTRAIT_SCALES = [1, 2, 3, 4, 6] as const;
export type PortraitScale = (typeof PORTRAIT_SCALES)[number];

/** Absolute path of a pre-rendered pixel portrait (integer scales only). */
export function portraitPath(id: string, scale: PortraitScale = 1, card = false): string {
  if (card) return join(spritesDir(), id, 'portrait-card@4x.png');
  return join(spritesDir(), id, scale === 1 ? 'portrait.png' : `portrait@${scale}x.png`);
}
