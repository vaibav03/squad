import { z } from 'zod';
import type { AssetSpec } from '../world/api';

/**
 * Tolerant reader for assets/asset-manifest.json (design foundation lead). The final shape was not published when this
 * was written, so we accept: `{ assets: Entry[] }`, a bare `Entry[]`, or `{ <key>: Entry-without-key }`, where
 * Entry = { key, type: image|spritesheet|atlas, path, frameWidth?, frameHeight?, atlasPath?, scope?|village? }.
 * Entries that fail validation are skipped (and reported), they never break boot. Entries tagged for another scope
 * (scope/village === false or a scope list without 'village'/'world') are skipped.
 */
const Entry = z
  .object({
    key: z.string().min(1),
    type: z.enum(['image', 'spritesheet', 'atlas']).default('image'),
    path: z.string().min(1),
    frameWidth: z.number().int().positive().optional(),
    frameHeight: z.number().int().positive().optional(),
    atlasPath: z.string().optional(),
    village: z.boolean().optional(),
    scope: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();

function wanted(e: z.infer<typeof Entry>): boolean {
  if (e.village === false) return false;
  if (e.scope === undefined) return true;
  const s = Array.isArray(e.scope) ? e.scope : [e.scope];
  return s.some((x) => ['village', 'world', 'game', 'pixel', 'all'].includes(x));
}

export function parseManifest(json: unknown): { specs: AssetSpec[]; skipped: number } {
  let raw: unknown[] = [];
  if (Array.isArray(json)) raw = json;
  else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.assets)) raw = o.assets;
    else if (o.assets && typeof o.assets === 'object')
      raw = Object.entries(o.assets).map(([key, v]) => ({ key, ...(v as object) }));
    else
      raw = Object.entries(o).map(([key, v]) =>
        v && typeof v === 'object' ? { key, ...(v as object) } : null,
      );
  }
  const specs: AssetSpec[] = [];
  let skipped = 0;
  for (const r of raw) {
    const p = Entry.safeParse(r);
    if (!p.success || !wanted(p.data)) {
      skipped++;
      continue;
    }
    const e = p.data;
    const path = e.path.replace(/^\/+/, '');
    if (e.type === 'spritesheet' && e.frameWidth && e.frameHeight)
      specs.push({
        type: 'spritesheet',
        key: e.key,
        path,
        frameWidth: e.frameWidth,
        frameHeight: e.frameHeight,
      });
    else if (e.type === 'atlas' && e.atlasPath)
      specs.push({ type: 'atlas', key: e.key, path, atlasPath: e.atlasPath.replace(/^\/+/, '') });
    else if (e.type === 'image') specs.push({ type: 'image', key: e.key, path });
    else skipped++;
  }
  return { specs, skipped };
}

/** Later specs win on key clash; manifest overrides module-owned stubs. */
export function mergeSpecs(...lists: AssetSpec[][]): AssetSpec[] {
  const m = new Map<string, AssetSpec>();
  for (const l of lists) for (const s of l) m.set(s.key, s);
  return [...m.values()];
}
