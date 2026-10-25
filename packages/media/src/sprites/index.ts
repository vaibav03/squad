import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Cell and anchors are frozen by docs/sprite-api.md. */
export const FRAME_CELL = { w: 24, h: 24 } as const;
export const ANCHORS = {
  feet: { x: 12, y: 23 },
  head: { x: 12, y: 9 },
  bubble: { x: 12, y: 5 },
  hand: { x: 17, y: 17 },
} as const;
export const ORIGIN_Y = 23 / 24;
export const ANIM_NAMES = ['idle', 'walk', 'talk'] as const;
export const DIRS = ['r', 'f'] as const;
export type AnimName = (typeof ANIM_NAMES)[number];
export type Dir = (typeof DIRS)[number];

const Pt = z.object({ x: z.number(), y: z.number() });
const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const FramesFileSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  cell: z.object({ w: z.number(), h: z.number() }),
  image: z.string(),
  anchors: z.object({ feet: Pt, head: Pt, bubble: Pt, hand: Pt }),
  frames: z.record(z.string(), Rect),
  anims: z.record(
    z.string(),
    z.object({ frames: z.array(z.string()).min(1), fps: z.number().positive(), loop: z.boolean() }),
  ),
});
export type FramesFile = z.infer<typeof FramesFileSchema>;

export const CastAtlasSchema = z.object({
  frames: z.record(
    z.string(),
    z.object({
      frame: Rect,
      rotated: z.boolean(),
      trimmed: z.boolean(),
      spriteSourceSize: Rect,
      sourceSize: z.object({ w: z.number(), h: z.number() }),
      pivot: Pt,
    }),
  ),
  meta: z
    .object({ image: z.string(), size: z.object({ w: z.number(), h: z.number() }) })
    .passthrough(),
});
export type CastAtlas = z.infer<typeof CastAtlasSchema>;

/** Repo root: packages/media/src/sprites -> up 4. Override with SQUAD_ROOT. */
export function repoRoot(): string {
  return process.env.SQUAD_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}
export const spritesDir = (): string => join(repoRoot(), 'assets', 'sprites');

export function loadFrames(id: string): FramesFile {
  const path = join(spritesDir(), id, 'frames.json');
  return FramesFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
export function loadCastAtlas(): CastAtlas {
  return CastAtlasSchema.parse(JSON.parse(readFileSync(join(spritesDir(), 'cast.json'), 'utf8')));
}

export const spriteFrameName = (id: string, anim: AnimName, dir: Dir, n: number): string =>
  `${id}/${anim}_${dir}_${n}`;

export interface PhaserAnim {
  key: string;
  frames: { key: 'cast'; frame: string }[];
  frameRate: number;
  repeat: number;
}

/** Pure data for scene.anims.create(); keys are '<id>/<anim>_<dir>'. Frame names index cast.json. */
export function phaserAnims(id: string, file: FramesFile = loadFrames(id)): PhaserAnim[] {
  return Object.keys(file.anims)
    .sort()
    .map((name) => {
      const a = file.anims[name]!;
      return {
        key: `${id}/${name}`,
        frames: a.frames.map((f) => ({ key: 'cast' as const, frame: `${id}/${f}` })),
        frameRate: a.fps,
        repeat: a.loop ? -1 : 0,
      };
    });
}
