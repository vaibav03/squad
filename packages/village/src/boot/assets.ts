import type Phaser from 'phaser';
import type { AssetApi, AssetSpec } from '../world/api';
import { mergeSpecs, parseManifest } from './manifest';

export function repoUrl(assetBase: string, repoPath: string): string {
  const base = assetBase.replace(/\/+$/, '');
  return `${base}/${repoPath.replace(/^\/+/, '').replace(/^assets\//, '')}`;
}

export const MANIFEST_TIMEOUT_MS = 8000;

/** Fetch + parse `<assetBase>/asset-manifest.json`. Missing or broken manifest returns []. */
export async function fetchManifest(
  assetBase: string,
  log: (m: string, e?: unknown) => void,
): Promise<AssetSpec[]> {
  // Gives up after 8 s: the manifest is awaited together with the engine chunk, so a hung request here would stall
  // the whole boot with nothing on screen but the loading text.
  const ctl = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const timer = ctl ? setTimeout(() => ctl.abort(), MANIFEST_TIMEOUT_MS) : undefined;
  try {
    const res = await fetch(
      repoUrl(assetBase, 'asset-manifest.json'),
      ctl ? { signal: ctl.signal } : {},
    );
    if (!res.ok) return [];
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return []; // SPA fallback
    const { specs, skipped } = parseManifest(await res.json());
    if (skipped) log(`manifest: skipped ${skipped} entries`);
    return specs;
  } catch (e) {
    log('manifest unavailable, using built-in stubs', e);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function queueSpecs(
  load: Phaser.Loader.LoaderPlugin,
  assetBase: string,
  specs: AssetSpec[],
): void {
  for (const s of mergeSpecs(specs)) {
    const url = repoUrl(assetBase, s.path);
    if (s.type === 'image') load.image(s.key, url);
    else if (s.type === 'spritesheet')
      load.spritesheet(s.key, url, {
        frameWidth: s.frameWidth,
        frameHeight: s.frameHeight,
        ...(s.endFrame !== undefined ? { endFrame: s.endFrame } : {}),
      });
    else load.atlas(s.key, url, repoUrl(assetBase, s.atlasPath));
  }
}

export function createAssetApi(
  getTextures: () => Phaser.Textures.TextureManager | undefined,
  assetBase: string,
): AssetApi {
  return {
    has: (key) => !!getTextures()?.exists(key),
    url: (p) => repoUrl(assetBase, p),
  };
}
