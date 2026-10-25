import { z } from 'zod';
import type { AssetSpec } from '../world/api';

/**
 * Reader for assets/asset-manifest.json (design foundation, `build_manifest.py`). Shape actually published:
 * `{ assets: [{ id, group, kind: image|tile|nineslice|spritesheet|atlas|font, file, size, frame?: {w,h,count},
 *   atlasJson?, variants?: { name: file } }] }`. Texture key = `id`; variants load as `<id>:<variant>`.
 * Fonts are not Phaser assets (CSS @font-face) and are skipped. Bad entries are skipped and counted, never fatal.
 */
const Entry = z
  .object({
    id: z.string().min(1),
    kind: z.string(),
    file: z.string().min(1),
    frame: z
      .object({ w: z.number().int().positive(), h: z.number().int().positive() })
      .partial({ w: true, h: true })
      .optional(),
    atlasJson: z.string().optional(),
    variants: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

const clean = (p: string) => p.replace(/^\/+/, '');

export function parseManifest(json: unknown): { specs: AssetSpec[]; skipped: number } {
  const raw = (
    json && typeof json === 'object' && Array.isArray((json as { assets?: unknown }).assets)
      ? (json as { assets: unknown[] }).assets
      : Array.isArray(json)
        ? json
        : []
  ) as unknown[];
  const specs: AssetSpec[] = [];
  let skipped = 0;
  for (const r of raw) {
    const p = Entry.safeParse(r);
    if (!p.success) {
      skipped++;
      continue;
    }
    const e = p.data;
    if (e.kind === 'font') continue;
    const add = (key: string, file: string) => {
      if (e.kind === 'spritesheet') {
        if (e.frame?.w && e.frame?.h)
          specs.push({
            type: 'spritesheet',
            key,
            path: clean(file),
            frameWidth: e.frame.w,
            frameHeight: e.frame.h,
          });
        else skipped++;
      } else if (e.kind === 'atlas') {
        if (e.atlasJson)
          specs.push({ type: 'atlas', key, path: clean(file), atlasPath: clean(e.atlasJson) });
        else skipped++;
      } else specs.push({ type: 'image', key, path: clean(file) });
    };
    // Per-persona entries are `atlas` without an atlasJson: their variants are 32x32 strips (walk, idle, ...) -> '<id>:<strip>' spritesheets.
    const stripsOnly = e.kind === 'atlas' && !e.atlasJson && !!e.frame?.w && !!e.frame?.h;
    if (stripsOnly) {
      for (const [name, file] of Object.entries(e.variants ?? {}))
        specs.push({
          type: 'spritesheet',
          key: `${e.id}:${name}`,
          path: clean(file),
          frameWidth: e.frame!.w!,
          frameHeight: e.frame!.h!,
        });
      continue;
    }
    add(e.id, e.file);
    // Variant textures ('lit'/'dark', 'dusk', ...). The default file is usually repeated as one variant: skip exact duplicates.
    for (const [name, file] of Object.entries(e.variants ?? {}))
      if (clean(file) !== clean(e.file)) add(`${e.id}:${name}`, file);
  }
  return { specs, skipped };
}

/** Later specs win on key clash; manifest overrides module-owned stubs. */
export function mergeSpecs(...lists: AssetSpec[][]): AssetSpec[] {
  const m = new Map<string, AssetSpec>();
  for (const l of lists) for (const s of l) m.set(s.key, s);
  return [...m.values()];
}
