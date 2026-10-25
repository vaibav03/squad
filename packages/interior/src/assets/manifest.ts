/**
 * The single asset indirection. The engine never names a file: it asks the manifest.
 *
 *   assets/interior/manifest.json        committed, points at the CC0 placeholder art
 *   assets/interior/manifest.local.json  gitignored, written by scripts/import-modern-interiors.mjs;
 *                                        deep-merged over the committed one, so the licensed pack (kept in
 *                                        gitignored assets/vendor/) drops in with no code change.
 *
 * All paths are relative to the asset base (default '/assets').
 */
import { z } from 'zod';

const Frame = z.object({ w: z.number().int().positive(), h: z.number().int().positive() });

const CharacterSheet = z.object({
  id: z.string(),
  image: z.string(),
  /** Overrides characters.frame for this sheet. */
  frame: Frame.optional(),
});

const AnimFrames = z.array(z.number().int().nonnegative()).min(1);

export const ManifestSchema = z.object({
  version: z.literal(1),
  pack: z.string(),
  tileset: z.object({ image: z.string(), def: z.string() }),
  props: z.object({ image: z.string(), def: z.string() }),
  maps: z.record(z.string(), z.string()),
  characters: z.object({
    frame: Frame,
    /** Feet anchor inside a frame, in pixels from the frame top-left. */
    anchor: z.object({ x: z.number(), y: z.number() }),
    fps: z.number().positive().default(8),
    /** Frame indices (row-major in the sheet) per animation: walk-<dir> and idle-<dir>. */
    anims: z.record(z.string(), AnimFrames),
    cast: z.array(CharacterSheet).min(1),
    /** Sheet id the player uses. */
    player: z.string(),
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep merge; arrays and scalars in `over` replace the base. */
export function mergeManifest(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? mergeManifest(base[k], v) : v;
  return out;
}

export function parseManifest(json: unknown): Manifest {
  return ManifestSchema.parse(json);
}

export const joinUrl = (base: string, rel: string): string =>
  /^(https?:)?\/\//.test(rel) || rel.startsWith('/')
    ? rel
    : `${base.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`;

export interface ManifestSource {
  fetchJson(url: string): Promise<unknown | undefined>;
}

/** Fetches committed manifest, overlays the optional local one. Returns which pack ended up active. */
export async function loadManifest(
  base: string,
  io: ManifestSource,
  log: (m: string, e?: unknown) => void = () => {},
): Promise<Manifest> {
  const main = await io.fetchJson(joinUrl(base, 'interior/manifest.json'));
  if (main === undefined) throw new Error('interior asset manifest not found');
  let merged: unknown = main;
  const local = await io
    .fetchJson(joinUrl(base, 'interior/manifest.local.json'))
    .catch(() => undefined);
  if (local !== undefined) {
    try {
      merged = mergeManifest(main, local);
      parseManifest(merged);
    } catch (e) {
      log('manifest.local.json is invalid; using the placeholder pack', e);
      merged = main;
    }
  }
  return parseManifest(merged);
}

/** Deterministic 32-bit string hash (FNV-1a) for stable skins. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Stable cast pick for an agent id, never the player's sheet. */
export function pickSkin(m: Manifest, agentId: string): string {
  const pool = m.characters.cast.filter((c) => c.id !== m.characters.player);
  const list = pool.length ? pool : m.characters.cast;
  return list[hashString(agentId) % list.length]!.id;
}

export const DIRS = ['down', 'up', 'left', 'right'] as const;
