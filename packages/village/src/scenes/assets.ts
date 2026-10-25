import type { Raster } from './pixel/raster';
import type { LoadedSkin } from './skins/runtime';

/** Manifest entry subset the scenes need (assets/asset-manifest.json). */
export interface ManifestAsset {
  id: string;
  file: string;
  kind: 'image' | 'spritesheet' | 'atlas' | string;
  size: [number, number];
  anchor?: [number, number];
  frame?: { w: number; h: number; count: number; fps?: number };
  variants?: Record<string, string>;
  glowAnchor?: [number, number];
  atlasJson?: string;
}

export interface AssetInfo {
  /** Raster to draw. */
  r: Raster;
  /** Anchor inside the raster (feet / bottom-centre); blit at (x - ax, y - ay). */
  ax: number;
  ay: number;
}

/**
 * What painters see of the art. `image('house.hut','lit')` = a composed PNG by manifest id and
 * variant; `frame('chairman','talk',1)` = a 32x32 cast frame (faces right, anchor [16,31]);
 * `sheet('fx.chimney-smoke', n)` = one frame of a spritesheet. Rasters are shared: never mutate.
 */
export interface AssetLib {
  has(id: string, variant?: string): boolean;
  image(id: string, variant?: string): AssetInfo;
  frame(persona: string, anim: string, n: number): AssetInfo;
  sheet(id: string, n: number): AssetInfo;
  /** The optional art skin for a scene (assets/vendor/interiors, local licensed art), or undefined for the classic art. */
  skin?(scene: string): LoadedSkin | undefined;
}

export type PngLoader = (repoPath: string) => Raster;

/** Build an AssetLib from the manifest and a PNG loader (node: fs+decoder; browser: decoded images). */
export function createAssetLib(
  manifest: { assets: ManifestAsset[] },
  atlasJson: { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> },
  load: PngLoader,
  skins: ReadonlyMap<string, LoadedSkin> = new Map(),
): AssetLib {
  const byId = new Map(manifest.assets.map((a) => [a.id, a]));
  const png = new Map<string, Raster>();
  const get = (p: string): Raster => {
    let r = png.get(p);
    if (!r) {
      r = load(p);
      png.set(p, r);
    }
    return r;
  };
  const cut = new Map<string, Raster>();
  const atlasAsset = byId.get('atlas.characters');
  const lookup = (id: string): ManifestAsset => {
    const a = byId.get(id);
    if (!a) throw new Error(`unknown asset ${id}`);
    return a;
  };
  return {
    skin: (scene) => skins.get(scene),
    has: (id, variant) => {
      const a = byId.get(id);
      return !!a && (!variant || !!a.variants?.[variant]);
    },
    image(id, variant) {
      const a = lookup(id);
      const file = variant ? a.variants?.[variant] : a.file;
      if (!file) throw new Error(`asset ${id} has no variant ${variant}`);
      const r = get(file);
      const anch = variant && a.glowAnchor && variant === 'glow' ? a.glowAnchor : a.anchor;
      return { r, ax: anch ? anch[0] : r.w >> 1, ay: anch ? anch[1] : r.h - 1 };
    },
    frame(persona, anim, n) {
      const key = `${persona}/${anim}/${n}`;
      let r = cut.get(key);
      if (!r) {
        const f = atlasJson.frames[key];
        if (!f) throw new Error(`unknown cast frame ${key}`);
        if (!atlasAsset) throw new Error('manifest has no atlas.characters');
        r = get(atlasAsset.file).crop(f.frame.x, f.frame.y, f.frame.w, f.frame.h);
        cut.set(key, r);
      }
      return { r, ax: 16, ay: 31 };
    },
    sheet(id, n) {
      const a = lookup(id);
      const fr = a.frame;
      if (!fr) throw new Error(`asset ${id} is not a spritesheet`);
      const i = ((n % fr.count) + fr.count) % fr.count;
      const key = `${id}#${i}`;
      let r = cut.get(key);
      if (!r) {
        r = get(a.file).crop(i * fr.w, 0, fr.w, fr.h);
        cut.set(key, r);
      }
      return { r, ax: a.anchor?.[0] ?? fr.w >> 1, ay: a.anchor?.[1] ?? fr.h - 1 };
    },
  };
}

/** Draw an asset with its anchor on (x, y). */
export function put(
  dst: Raster,
  a: AssetInfo,
  x: number,
  y: number,
  opts: { flipX?: boolean; alpha?: number } = {},
): void {
  dst.blit(a.r, x - (opts.flipX ? a.r.w - 1 - a.ax : a.ax), y - a.ay, opts);
}
