import type { Raster } from '../pixel/raster';
import { SKIN_INDEX, SKIN_ROOT, type LayerName, type SkinIndex, type SkinLayout, type SkinManifest } from './types';

/** A skin ready to paint: decoded layers plus its anchors. Rasters are shared, never mutate. */
export interface LoadedSkin {
  id: string;
  scene: string;
  title: string;
  credit: string;
  layout: SkinLayout;
  layers: Partial<Record<LayerName, Raster>>;
}

/** `?skin=off` always wins; `?skin=modern-interiors` probes even when the host did not detect the local art. */
export type SkinMode = 'off' | 'auto' | 'force';

export const SKIN_META = 'squad-interior-skin';

/** Pure: decide from the query string and whether the host page carries the build-time detection marker. */
export function skinMode(search: string, detected: boolean): SkinMode | 'none' {
  const q = /[?&]skin=([^&]*)/.exec(search)?.[1];
  if (q === 'off' || q === 'classic' || q === '0') return 'off';
  if (q === 'modern-interiors' || q === 'on') return 'force';
  return detected ? 'auto' : 'none';
}

export function detectedInPage(doc: Document | undefined = globalThis.document): boolean {
  return !!doc?.querySelector?.(`meta[name="${SKIN_META}"]`);
}

/** True when `p` is a repo-relative path the skin loader may fetch (guards a hostile manifest). */
export function safeSkinPath(p: string): boolean {
  return /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(p) && !p.includes('..');
}

const isManifest = (m: unknown): m is SkinManifest => {
  const o = m as SkinManifest | undefined;
  return (
    !!o &&
    o.version === 1 &&
    typeof o.id === 'string' &&
    typeof o.scene === 'string' &&
    !!o.layers?.bg &&
    !!o.layout &&
    Array.isArray(o.layout.seats) &&
    o.layout.seats.length === 3
  );
};

/**
 * Fetch the local skin index and manifests. Never throws and never logs: a missing index (CI, other machines, no pack)
 * simply means "no skins", and the classic art stays. `fetchJson` returns undefined on any failure.
 */
export async function fetchSkinManifests(
  url: (repoPath: string) => string,
  fetchJson: (u: string) => Promise<unknown | undefined>,
): Promise<SkinManifest[]> {
  try {
    const idx = (await fetchJson(url(SKIN_INDEX))) as SkinIndex | undefined;
    if (!idx || idx.version !== 1 || typeof idx.skins !== 'object' || !idx.skins) return [];
    const out: SkinManifest[] = [];
    for (const rel of Object.values(idx.skins)) {
      if (typeof rel !== 'string' || !safeSkinPath(rel)) continue;
      const m = await fetchJson(url(`${SKIN_ROOT}/${rel}`));
      if (isManifest(m) && Object.values(m.layers).every((f) => typeof f === 'string' && safeSkinPath(f))) out.push(m);
    }
    return out;
  } catch {
    return [];
  }
}

/** Repo path of a layer image: assets/vendor/interiors/<id>/<file>. */
export const layerPath = (m: SkinManifest, layer: LayerName): string | undefined =>
  m.layers[layer] ? `${SKIN_ROOT}/${m.id}/${m.layers[layer]}` : undefined;

/** The page-level record of which skins are active (read by the DOM for the credit line). */
const KEY = '__squadActiveSkins';
export interface ActiveSkin {
  scene: string;
  id: string;
  title: string;
  credit: string;
}
export function publishActiveSkins(list: ActiveSkin[]): void {
  (globalThis as Record<string, unknown>)[KEY] = list;
  globalThis.dispatchEvent?.(new Event('squad:skins'));
}
const NONE: readonly ActiveSkin[] = [];
export function getActiveSkins(): readonly ActiveSkin[] {
  return ((globalThis as Record<string, unknown>)[KEY] as ActiveSkin[] | undefined) ?? NONE;
}
