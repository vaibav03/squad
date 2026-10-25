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
const DOT_CSS = /border-radius:\s*50%/;

const allow = existsSync(join(ROOT, 'scripts/audit-chrome.allow.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'scripts/audit-chrome.allow.json'), 'utf8')).entries
  : [];
const allowed = (file, kind, line) =>
  allow.some((a) => new RegExp(a.path).test(file) && (!a.kind || a.kind === kind) && (!a.match || line.includes(a.match)));

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
for (const area of AREAS) {
  const base = join(ROOT, area);
  if (!existsSync(base)) continue;
  for (const f of walk(base)) {
    const rel = relative(ROOT, f);
    const lines = readFileSync(f, 'utf8').split('\n');
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
      if (MARKERS.test(line)) push('marker');
      if (extname(f) === '.css' && DOT_CSS.test(line)) push('dot');
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
process.exit(found.length ? 1 : 0);
