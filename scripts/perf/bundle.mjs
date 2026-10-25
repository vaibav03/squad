#!/usr/bin/env node
// Static bundle report for apps/web-host/dist (run `pnpm --filter @squad/web-host build` first).
// Writes docs/perf/data/bundle.json: per-file raw/gzip/brotli, totals per type, source-map weight.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'apps/web-host/dist');
if (!existsSync(dist)) {
  console.error('apps/web-host/dist missing: run `pnpm --filter @squad/web-host build`');
  process.exit(2);
}
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(dist).map((p) => {
  const buf = readFileSync(p);
  const ext = extname(p);
  const compressible = ['.js', '.css', '.html', '.json', '.svg'].includes(ext);
  return {
    file: p.slice(dist.length + 1),
    ext,
    raw: buf.length,
    gzip: compressible ? gzipSync(buf, { level: 9 }).length : buf.length,
    brotli: compressible ? brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length : buf.length,
  };
});
const sum = (list, k) => list.reduce((a, f) => a + f[k], 0);
const by = (ext) => files.filter((f) => f.ext === ext);
const js = by('.js');
const phaser = js.find((f) => /(^|\/)phaser-/.test(f.file));
const mainJs = js.filter((f) => f !== phaser).sort((a, b) => b.raw - a.raw);
const out = {
  generatedAt: new Date().toISOString(),
  totals: {
    jsRaw: sum(js, 'raw'), jsGzip: sum(js, 'gzip'), jsBrotli: sum(js, 'brotli'),
    cssGzip: sum(by('.css'), 'gzip'),
    mapRaw: sum(by('.map'), 'raw'),
    fontsRaw: sum(by('.woff2'), 'raw'),
  },
  phaserChunk: phaser ?? null,
  largestNonPhaserJs: mainJs[0] ?? null,
  files: files.filter((f) => f.ext !== '.map').sort((a, b) => b.raw - a.raw),
};
mkdirSync(join(root, 'docs/perf/data'), { recursive: true });
writeFileSync(join(root, 'docs/perf/data/bundle.json'), JSON.stringify(out, null, 2));
const kb = (n) => (n / 1024).toFixed(1) + ' kB';
console.log(`JS ${kb(out.totals.jsRaw)} raw / ${kb(out.totals.jsGzip)} gzip / ${kb(out.totals.jsBrotli)} br; CSS ${kb(out.totals.cssGzip)} gzip; maps ${kb(out.totals.mapRaw)}`);
console.log(`phaser chunk ${phaser ? `${phaser.file} ${kb(phaser.raw)} / ${kb(phaser.gzip)} gzip` : 'not found'}`);
console.log(`largest app chunk ${out.largestNonPhaserJs?.file} ${kb(out.largestNonPhaserJs?.raw ?? 0)} / ${kb(out.largestNonPhaserJs?.gzip ?? 0)} gzip`);
