import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';
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

/** INTEGRATION GLUE: serves the repo `assets/` dir at /assets (the village asset contract), in dev and in `vite preview`. */
function repoAssetsPlugin(): Plugin {
  const serve: Connect.NextHandleFunction = (req, res, next) => {
    const p = normalize(join(repoAssets, decodeURIComponent((req.url ?? '/').split('?')[0]!)));
    if (!p.startsWith(repoAssets) || !existsSync(p) || !statSync(p).isFile()) return next();
    res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream');
    createReadStream(p).pipe(res);
  };
  return {
    name: 'squad-repo-assets',
    configureServer(server) {
      server.middlewares.use('/assets', serve);
    },
    configurePreviewServer(server) {
      // Repo assets win over the built bundle's own /assets (hashed JS and CSS never clash with these paths).
      server.middlewares.use('/assets', serve);
    },
  };
}

export default defineConfig({
  plugins: [react(), repoAssetsPlugin()],
  server: { port: 5180, strictPort: false, fs: { allow: [resolve(__dirname, '../..')] } },
  preview: { port: 5180 },
  build: {
    // deploy: source maps stay off in production builds (SQUAD_SOURCEMAP=1 opts in; never ship them publicly).
    sourcemap: process.env.SQUAD_SOURCEMAP === '1',
    // deploy: hashed bundles live under /static so the unhashed repo art can own /assets (long-cache split).
    assetsDir: 'static',
    chunkSizeWarningLimit: 1600,
  },
});
