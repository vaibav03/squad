import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoAssets = fileURLToPath(new URL('../../assets', import.meta.url));
const types: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

/** Serves the repo `assets/` dir at /assets (the same contract apps/web-host must provide). */
function repoAssetsPlugin(): Plugin {
  return {
    name: 'squad-repo-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (req, res, next) => {
        const p = normalize(join(repoAssets, decodeURIComponent((req.url ?? '/').split('?')[0]!)));
        if (!p.startsWith(repoAssets) || !existsSync(p) || !statSync(p).isFile()) return next();
        res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream');
        createReadStream(p).pipe(res);
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('./dev', import.meta.url)),
  plugins: [repoAssetsPlugin()],
  server: {
    port: 5191,
    strictPort: false,
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] },
  },
});
