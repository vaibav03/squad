import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createAssetLib, type AssetLib } from '../assets';
import { decodePng } from './png-decode';

const ROOT = resolve(import.meta.dirname, '../../../../../');
let lib: AssetLib | null = null;

/** AssetLib over the repo's composed art, decoded from disk (tests and frame capture). */
export function nodeAssets(): AssetLib {
  if (lib) return lib;
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'assets/asset-manifest.json'), 'utf8'));
  const atlas = JSON.parse(readFileSync(resolve(ROOT, 'assets/pixel/composed/characters/atlas.json'), 'utf8'));
  lib = createAssetLib(manifest, atlas, (p) => decodePng(readFileSync(resolve(ROOT, p))));
  return lib;
}
