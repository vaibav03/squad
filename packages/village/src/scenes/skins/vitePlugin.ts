import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Boot-time detection of the optional indoor skins: when the locally imported art exists (assets/vendor/interiors/index.json,
 * written by `pnpm interior:import`), index.html gets `<meta name="squad-interior-skin">` and the scenes module tries to load it.
 * Without the files (CI, other machines) nothing is added and nothing is fetched. Re-evaluated on every page load in dev.
 */
export function interiorSkinPlugin(repoRoot: string): Plugin {
  const index = resolve(repoRoot, 'assets/vendor/interiors/index.json');
  return {
    name: 'squad-interior-skin',
    transformIndexHtml: () =>
      existsSync(index)
        ? [
            {
              tag: 'meta',
              attrs: { name: 'squad-interior-skin', content: 'on' },
              injectTo: 'head' as const,
            },
          ]
        : [],
  };
}
