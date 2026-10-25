import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { repoRoot } from './index.js';

/**
 * Where a persona's sprites come from. Generated casts live in assets/sprites (tracked).
 * Imported packs (Modern Interiors etc.) live under assets/vendor/ (gitignored, local only) and are
 * described by a frames.json (v3, topdown4) that an import script writes next to the pack.
 */
export const SpriteSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generated'), view: z.enum(['side', 'topdown4']).default('side') }),
  z.object({
    kind: z.literal('imported'),
    view: z.enum(['side', 'topdown4']).default('topdown4'),
    /** Repo-relative path, must start with assets/vendor/. */
    path: z.string().regex(/^assets\/vendor\/.+/),
    /** Frames file inside that folder (v3 shape, see docs/sprite-api.md). */
    framesFile: z.string().default('frames.json'),
  }),
]);
export type SpriteSource = z.infer<typeof SpriteSourceSchema>;

export const GENERATED_SIDE: SpriteSource = { kind: 'generated', view: 'side' };

export interface ResolvedSprites {
  source: SpriteSource;
  /** Repo-relative frames.json that is actually usable. */
  framesPath: string;
  /** True when an imported pack was requested but is not on this machine. */
  fellBack: boolean;
}

/** Resolve a persona's sprite source; a missing vendor pack falls back to the generated side cast. */
export function resolveSprites(
  id: string,
  source: SpriteSource = GENERATED_SIDE,
  fallbackFrames = `assets/sprites/${id}/frames.json`,
): ResolvedSprites {
  if (source.kind === 'imported') {
    const rel = join(source.path, source.framesFile);
    if (existsSync(join(repoRoot(), rel))) return { source, framesPath: rel, fellBack: false };
    return { source: GENERATED_SIDE, framesPath: fallbackFrames, fellBack: true };
  }
  return { source, framesPath: fallbackFrames, fellBack: false };
}
