#!/usr/bin/env node
// Source-level chrome audit: no decorative emoji or dot markers in product chrome.
// Emoji stays only in user-authored content. Allowlist: scripts/audit-chrome.allow.json (path regex + reason).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const AREAS = ['packages/web/src', 'packages/village/src', 'apps/web-host', 'apps/extension', 'apps/hub/src'];
const EXT = new Set(['.ts', '.tsx', '.css', '.html', '.js', '.jsx', '.mjs']);
const SKIP_DIR = new Set(['node_modules', 'dist', 'e2e', 'assets', 'fixtures', '.vite', 'coverage']);
const SKIP_FILE = /\.(test|spec)\.[tj]sx?$|fixtures?\.[tj]sx?$|\.d\.ts$/;

const EMOJI = /\p{Extended_Pictographic}|️|\p{Regional_Indicator}/u;
// Marker glyphs used as visible decoration. Arrows and ≠/≡ are only flagged in JSX text or string literals.
const MARKERS = /[●•◆▲○◐◑⚙✓✕≠≡→◇■□▪▫★☆♥]/u;
const ESCAPED = /\\u(25[a-f0-9]{2}|26[a-f0-9]{2}|27[0-9a-f]{2}|2022|2B[0-9A-F]{2}|\{1f[0-9a-f]{3,4}\})|\\u\{1[fF][0-9a-fA-F]{3,4}\}|&(bull|#x?(25|26|27|2022|1f)[0-9a-f]*);/i;
const DOT_CSS = /border-radius:\s*50%/;

const allow = existsSync(join(ROOT, 'scripts/audit-chrome.allow.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'scripts/audit-chrome.allow.json'), 'utf8')).entries
  : [];
let pendingHits = 0;
const allowed = (file, kind, line) => {
  const hit = allow.find((a) => new RegExp(a.path).test(file) && (!a.kind || a.kind === kind) && (!a.match || line.includes(a.match)));
  if (hit?.pending) pendingHits++;
  return Boolean(hit);
};

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIR.has(n)) continue;
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(extname(n)) && !SKIP_FILE.test(n)) yield p;
  }
}

const found = [];
// CSS dots: a rule block with border-radius 50%, width and height <= 12px and a solid background is a status dot.
function cssDots(rel, text, area) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2];
    if (!DOT_CSS.test(body)) continue;
    const w = /(?:^|[;\s])width:\s*(\d+)px/.exec(body);
    const h = /(?:^|[;\s])height:\s*(\d+)px/.exec(body);
    if (!w || !h || +w[1] > 12 || +h[1] > 12 || !/background(-color)?:\s*(?!transparent|none)/.test(body)) continue;
    const sel = m[1].trim().split('\n').pop();
    const line = text.slice(0, m.index + m[1].length).split('\n').length;
    if (!allowed(rel, 'dot', sel)) found.push({ area, file: rel, line, kind: 'dot', text: sel.slice(0, 110) });
  }
}
for (const area of AREAS) {
  const base = join(ROOT, area);
  if (!existsSync(base)) continue;
  for (const f of walk(base)) {
    const rel = relative(ROOT, f);
    const src = readFileSync(f, 'utf8');
    if (extname(f) === '.css') cssDots(rel, src, area);
    const lines = src.split('\n');
    let inBlock = false;
    lines.forEach((raw, i) => {
      let line = raw;
      // skip comments
      if (inBlock) {
        if (line.includes('*/')) { inBlock = false; line = line.slice(line.indexOf('*/') + 2); } else return;
      }
      line = line.replace(/\/\*.*?\*\//g, '');
      if (line.includes('/*')) { inBlock = true; line = line.slice(0, line.indexOf('/*')); }
      line = line.replace(/(^|\s)\/\/.*$/, '$1').replace(/<!--.*?-->/g, '');
      if (!line.trim()) return;
      const push = (kind) => {
        if (!allowed(rel, kind, raw)) found.push({ area, file: rel, line: i + 1, kind, text: raw.trim().slice(0, 110) });
      };
      if (EMOJI.test(line)) push('emoji');
      if (MARKERS.test(line) || ESCAPED.test(line)) push('marker');
    });
  }
}

const byArea = {};
for (const x of found) {
  byArea[x.area] ??= { emoji: 0, marker: 0, dot: 0 };
  byArea[x.area][x.kind]++;
}
if (process.argv.includes('--verbose') || found.length) {
  for (const x of found.slice(0, process.argv.includes('--all') ? Infinity : 80))
    console.log(`${x.file}:${x.line} [${x.kind}] ${x.text}`);
}
console.log('\naudit:chrome counts by area (emoji / marker / css-dot):');
for (const a of AREAS) {
  const c = byArea[a] ?? { emoji: 0, marker: 0, dot: 0 };
  console.log(`  ${a.padEnd(22)} ${c.emoji} / ${c.marker} / ${c.dot}`);
}
console.log(`total violations: ${found.length}`);
if (pendingHits) console.log(`pending (allowlisted, to convert): ${pendingHits}`);
process.exit(found.length ? 1 : 0);
