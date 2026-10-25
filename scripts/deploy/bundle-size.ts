/**
 * Bundle size report + budgets for the production web host build.
 *   pnpm --filter @squad/web-host build && pnpm tsx scripts/deploy/bundle-size.ts [--json out.json] [--md out.md]
 * Exits 1 when a budget in deploy/bundle-budgets.json is exceeded. Also fails if source maps shipped in dist.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = resolve(ROOT, process.env.WEB_DIST ?? 'apps/web-host/dist');
const budgets = JSON.parse(
  readFileSync(join(ROOT, 'deploy/bundle-budgets.json'), 'utf8'),
) as Record<string, number>;
const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(DIST).map((p) => {
  const buf = readFileSync(p);
  const textual = /\.(js|css|html|json|svg|mjs)$/.test(p);
  return {
    path: relative(DIST, p),
    bytes: buf.length,
    gzip: textual ? gzipSync(buf).length : buf.length,
  };
});
const kib = (n: number) => Math.round((n / 1024) * 10) / 10;
const js = files.filter((f) => f.path.endsWith('.js'));
const css = files.filter((f) => f.path.endsWith('.css'));
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entryRef = /<script[^>]*type="module"[^>]*src="\/([^"]+)"/.exec(html)?.[1];
const entry = js.find((f) => f.path === entryRef);
const preloads = [...html.matchAll(/modulepreload"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]);
const lazy = js.filter((f) => f !== entry && !preloads.includes(f.path));
const largestLazy = [...lazy].sort((a, b) => b.gzip - a.gzip)[0];
const distBytes = files.reduce((a, f) => a + f.bytes, 0);

const checks = [
  ['entry JS (gzip KiB)', kib(entry?.gzip ?? 0), budgets.entryJsGzipKiB],
  ['largest lazy chunk (gzip KiB)', kib(largestLazy?.gzip ?? 0), budgets.largestLazyChunkGzipKiB],
  ['total JS (gzip KiB)', kib(js.reduce((a, f) => a + f.gzip, 0)), budgets.totalJsGzipKiB],
  ['total CSS (gzip KiB)', kib(css.reduce((a, f) => a + f.gzip, 0)), budgets.totalCssGzipKiB],
  ['dist total (MiB)', Math.round((distBytes / 1048576) * 10) / 10, budgets.distTotalMiB],
] as const;
const maps = files.filter((f) => f.path.endsWith('.map'));
const vendor = files.filter((f) => /vendor|modern.?interiors/i.test(f.path));

const lines = [
  '# Web host bundle report',
  '',
  '| metric | value | budget | status |',
  '|---|---|---|---|',
];
let fail = false;
for (const [name, val, max] of checks) {
  const ok = max === undefined || val <= max;
  if (!ok) fail = true;
  lines.push(`| ${name} | ${val} | ${max} | ${ok ? 'ok' : 'OVER'} |`);
}
if (maps.length) {
  fail = true;
  lines.push('', `FAIL: ${maps.length} source map(s) in dist`);
}
if (vendor.length) {
  fail = true;
  lines.push('', `FAIL: vendor/licensed art in dist: ${vendor.map((v) => v.path).join(', ')}`);
}
lines.push('', '## Largest files', '', '| file | KiB | gzip KiB |', '|---|---|---|');
for (const f of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 15))
  lines.push(`| ${f.path} | ${kib(f.bytes)} | ${kib(f.gzip)} |`);
const md = lines.join('\n');
console.log(md);
if (arg('--md')) writeFileSync(arg('--md')!, md + '\n');
if (arg('--json'))
  writeFileSync(arg('--json')!, JSON.stringify({ checks, files, pass: !fail }, null, 2));
process.exit(fail ? 1 : 0);
