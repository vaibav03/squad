import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Cell and anchors are frozen by docs/sprite-api.md (format v2: 32 px side-view cells, feet anchor, faces right). */
export const FRAME_CELL = { w: 32, h: 32 } as const;
export const FEET_ANCHOR = { x: 16, y: 31 } as const;
export const ANIM_FPS = { idle: 2, walk: 8, talk: 8, sit: 2, wave: 4 } as const;
export const ANIM_FRAMES = { idle: 2, walk: 4, talk: 2, sit: 2, wave: 2 } as const;
export type AnimName = keyof typeof ANIM_FPS;
export const ANIM_NAMES = Object.keys(ANIM_FPS) as AnimName[];
export const WALK_SPEED_PX_PER_SEC = 24;

const Pt = z.object({ x: z.number(), y: z.number() });
const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const Anim = z.object({
  frames: z.array(z.string()).min(1),
  frameRate: z.number().positive(),
  repeat: z.number(),
});

/** Walk-facing sets for the top-down campus (Modern Interiors style, 4-direction). */
export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * Format v2 = side view, anims keyed '<anim>' (what ships today).
 * Format v3 = same file shape, plus view 'topdown4' where anims are keyed '<anim>/<dir>' for each
 * direction in `directions`, frames named '<anim>/<dir>/<n>'. v2 files stay valid unchanged.
 */
export const FramesFileSchema = z
  .object({
    version: z.union([z.literal(2), z.literal(3)]),
    id: z.string(),
    cell: z.object({ w: z.number(), h: z.number() }),
    view: z.enum(['side', 'topdown4']).default('side'),
    facing: z.literal('right').optional(),
    directions: z.array(z.enum(DIRECTIONS)).optional(),
    poc: z.boolean().optional(),
    anchors: z.object({ feet: Pt, head: Pt, bubble: Pt }),
    portrait: z.string(),
    frames: z.record(z.string(), Rect.extend({ strip: z.string() })),
    anims: z.record(z.string(), Anim),
  })
  .superRefine((f, ctx) => {
    if (f.view !== 'topdown4') return;
    const dirs = f.directions ?? [];
    if (dirs.length !== 4)
      ctx.addIssue({ code: 'custom', message: 'topdown4 needs all 4 directions' });
    for (const d of dirs)
      if (!f.anims[`walk/${d}`] || !f.anims[`idle/${d}`])
        ctx.addIssue({ code: 'custom', message: `missing walk/idle for ${d}` });
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
      pivot: Pt.optional(),
    }),
  ),
  animations: z.record(z.string(), z.record(z.string(), Anim)),
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

export const spriteFrameName = (id: string, anim: AnimName, n: number): string =>
  `${id}/${anim}/${n}`;

export interface PhaserAnim {
  key: string;
  frames: { key: 'cast'; frame: string }[];
  frameRate: number;
  repeat: number;
}

/** Pure data for scene.anims.create(); keys are '<id>/<anim>'. Frame names index cast.json ('<id>/<anim>/<n>'). */
export function phaserAnims(id: string, file: FramesFile = loadFrames(id)): PhaserAnim[] {
  return Object.keys(file.anims)
    .sort()
    .map((name) => {
      const a = file.anims[name]!;
      return {
        key: `${id}/${name}`,
        frames: a.frames.map((f) => ({ key: 'cast' as const, frame: `${id}/${f}` })),
        frameRate: a.frameRate,
        repeat: a.repeat,
      };
    });
}

/** Animation key for a facing: side view ignores dir, top-down appends it ('walk/down'). */
export function animKey(file: FramesFile, anim: string, dir: Direction = 'down'): string {
  return file.view === 'topdown4' ? `${anim}/${dir}` : anim;
}
export * from './source.js';
