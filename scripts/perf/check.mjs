#!/usr/bin/env node
// pnpm perf:check [--skip-runtime]  : builds nothing for you; needs apps/web-host/dist (pnpm --filter @squad/web-host build).
// Runs the bundle report and the runtime measurement, compares to scripts/perf/budgets.json, exits 1 on any failure.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const run = (f) => {
  const r = spawnSync('node', [join(here, f)], { cwd: root, stdio: 'inherit' });
  if (r.status) process.exit(r.status);
};
run('bundle.mjs');
const skip = process.argv.includes('--skip-runtime');
if (!skip) run('runtime.mjs');
const J = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const b = J('scripts/perf/budgets.json');
const bundle = J('docs/perf/data/bundle.json');
const rt = J('docs/perf/data/runtime.json');
const kb = (n) => n / 1024;
const rows = [];
const chk = (name, actual, max, { min = false, warn = false } = {}) => {
  const ok = min ? actual >= max : actual <= max;
  rows.push({
    name,
    actual: Math.round(actual * 100) / 100,
    budget: (min ? '>= ' : '<= ') + max,
    result: ok ? 'ok' : warn ? 'WARN' : 'FAIL',
  });
};
chk('phaser chunk gzip kB', kb(bundle.phaserChunk?.gzip ?? 0), b.bundle.phaserGzipKb);
chk(
  'largest app chunk gzip kB',
  kb(bundle.largestNonPhaserJs?.gzip ?? 0),
  b.bundle.largestAppChunkGzipKb,
);
chk('total JS gzip kB', kb(bundle.totals.jsGzip), b.bundle.totalJsGzipKb);
chk('total JS brotli kB', kb(bundle.totals.jsBrotli), b.bundle.totalJsBrotliKb);
if (!skip) {
  const nonVillage = Object.entries(rt.routes).filter(([r]) => r !== '/squad/village');
  chk(
    'max non-village route JS kB',
    Math.max(...nonVillage.map(([, v]) => v.jsKb)),
    b.routes.nonVillageJsKb,
  );
  chk('village route JS kB', rt.routes['/squad/village'].jsKb, b.routes.villageJsKb);
  if (b.routes.phaserOnlyOnVillage)
    chk(
      'routes loading phaser besides village',
      nonVillage.filter(([, v]) => v.phaserLoaded).length,
      0,
    );
  const strict = process.env.STRICT_FPS === '1';
  for (const [vp, v] of Object.entries(rt.village)) {
    chk(`${vp} ready ms`, v.readyMs, b.village.readyMs);
    chk(`${vp} LCP ms`, v.lcpMs, b.village.lcpMs);
    chk(`${vp} CLS`, v.cls, b.village.cls);
    chk(`${vp} fps p5`, v.fps.p5, b.village.fpsP5Min, { min: true, warn: !strict });
    chk(`${vp} heap growth MB`, v.heapGrowthMbInWindow, b.village.heapGrowthMbMax);
  }
}
console.table(rows);
const failed = rows.filter((r) => r.result === 'FAIL');
console.log(failed.length ? `perf:check FAILED (${failed.length})` : 'perf:check passed');
process.exit(failed.length ? 1 : 0);
