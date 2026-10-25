import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const repoAssets = resolve(__dirname, '../../assets');
const types: Record<string, string> = {
  '.png': 'image/png',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

/** INTEGRATION GLUE: serves the repo `assets/` dir at /assets (the village asset contract). */
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
  plugins: [react(), repoAssetsPlugin()],
  server: { port: 5180, strictPort: false, fs: { allow: [resolve(__dirname, '../..')] } },
  preview: { port: 5180 },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
});
