import react from '@vitejs/plugin-react';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { execFileSync } from 'node:child_process';
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

/**
 * Build marker, fixed when the dev server starts or the bundle is built: git short sha (12, the same form the hub
 * reports in /v1/status) plus a timestamp. The app compares it with the hub's sha and warns about a stale build.
 */
function buildInfo() {
  const env = process.env.GIT_SHA || process.env.SOURCE_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA;
  let sha = env ? env.slice(0, 12) : 'unknown';
  if (!env)
    try {
      sha = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
        .toString()
        .trim();
    } catch {
      /* no git: the marker says "unknown" and never warns */
    }
  return { sha, builtAt: process.env.BUILD_TIME || new Date().toISOString() };
}

const build = buildInfo();

/** Puts the build sha into the static boot state in index.html. */
function bootBuildPlugin(): Plugin {
  return {
    name: 'squad-boot-build',
    transformIndexHtml: (html) => html.replaceAll('%SQUAD_BUILD%', build.sha),
  };
}

export default defineConfig({
  define: { __SQUAD_BUILD__: JSON.stringify(build) },
  plugins: [react(), repoAssetsPlugin(), bootBuildPlugin()],
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
