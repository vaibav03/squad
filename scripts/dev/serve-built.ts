/**
 * pnpm demo:serve: drop-in replacement for `pnpm dev:all` that serves the PRODUCTION build of the web host.
 *
 * Same ports, env vars and wiring as dev:all (DEV_ALL_HUB_PORT 8788, DEV_ALL_WEB_PORT 5180, DEV_ALL_AGENT_PORT_BASE 4101),
 * same hub + agents, but the web host is `vite build` output (VITE_HUB_URL baked in from the hub port, build marker
 * included) behind scripts/dev/lib/static-server.ts (brotli/gzip, immutable /static caching, no-cache index.html, SPA fallback).
 *
 * Flags: --no-agents, --no-hub (web only, against a hub that already runs), --no-build (never build, fail if no
 * dist), --rebuild (force a build). Default: build only when dist is missing or its stamp (git sha + hub url) differs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, runStack } from './lib/stack';

const args = new Set(process.argv.slice(2));
const dist = path.join(ROOT, 'apps/web-host/dist');
const stampFile = path.join(dist, '.demo-serve-stamp');

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

runStack({
  label: 'demo (production build)',
  args,
  noHubFlag: '--no-hub',
  web: ({ baseEnv, webPort, webUrl }) => ({
    name: 'web',
    color: 33,
    cmd: [
      'pnpm',
      'exec',
      'tsx',
      'scripts/dev/static-main.ts',
      String(webPort),
      dist,
      path.join(ROOT, 'assets'),
    ],
    env: baseEnv,
    health: `${webUrl}/`,
    url: webUrl,
    port: webPort,
  }),
  prepare: async ({ baseEnv, hubUrl, runStep }) => {
    const stamp = `${gitSha()} ${hubUrl}`;
    const have = existsSync(path.join(dist, 'index.html'));
    const current = have && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp;
    if (args.has('--no-build')) {
      if (!have) {
        console.error('--no-build but apps/web-host/dist does not exist; run without it once');
        process.exit(1);
      }
      console.log(
        `using existing build (stamp: ${have && existsSync(stampFile) ? readFileSync(stampFile, 'utf8') : 'none'})`,
      );
      return;
    }
    if (current && !args.has('--rebuild')) {
      console.log(`build is current (${stamp}); pass --rebuild to force. Skipping vite build.`);
      return;
    }
    console.log(`building web host (VITE_HUB_URL=${hubUrl}) ...`);
    const t0 = Date.now();
    const code = await runStep(
      'build',
      ['pnpm', '--filter', '@squad/web-host', 'exec', 'vite', 'build'],
      baseEnv,
    );
    if (code !== 0) {
      console.error(`vite build failed (exit ${code})`);
      process.exit(1);
    }
    writeFileSync(stampFile, stamp);
    console.log(`build done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  },
});
