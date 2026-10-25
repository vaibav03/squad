import { join } from 'node:path';
import { spritesDir } from '../sprites/index.js';

export type GifKind = 'hello' | 'talk';
/** Absolute path of a prebuilt iMessage GIF for a persona. */
export const gifPath = (id: string, kind: GifKind = 'hello'): string =>
  join(spritesDir(), id, `${kind}.gif`);
