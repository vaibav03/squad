#!/usr/bin/env node
// WCAG AA check for the council chamber tokens (docs/design/tokens.css --cc-*): every text pair must reach 4.5:1,
// every non-text accent used for an outline or an icon 3:1. Also checks docs/design/tokens.ts mirrors the CSS values.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const css = readFileSync(join(ROOT, 'docs/design/tokens.css'), 'utf8');
const ts = readFileSync(join(ROOT, 'docs/design/tokens.ts'), 'utf8');
const val = (name) => {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`token --${name} missing`);
  return m[1].trim();
};
const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const color = (name) => {
  const v = val(name);
  if (v.startsWith('#')) return [...hex(v), 1];
  const m = /rgb\(([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(v);
  if (!m) throw new Error(`cannot parse --${name}: ${v}`);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
};
const over = (top, bottom) => {
  const a = top[3] + bottom[3] * (1 - top[3]);
  return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a);
};
const lum = ([r, g, b]) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (x, y) => {
  const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const surface = color('cc-surface');
const raised = over(color('cc-glass-raised'), surface);
const tint = (fg, a) => over([fg[0], fg[1], fg[2], a], surface);
const pairs = [];
const text = (label, fg, bg, min = 4.5) => pairs.push({ label, fg, bg, min });
for (const bg of [['surface', surface], ['raised card', raised]]) {
  text(`text on ${bg[0]}`, color('cc-text'), bg[1]);
  text(`dim text on ${bg[0]}`, color('cc-text-dim'), bg[1]);
  for (const n of ['amber', 'cyan', 'rose', 'violet', 'green']) text(`${n} on ${bg[0]}`, color(`cc-${n}`), bg[1]);
}
for (const n of ['amber', 'cyan', 'rose', 'violet', 'green'])
  text(`${n} chip (12% tint) on raised card`, color(`cc-${n}`), tint(color(`cc-${n}`), 0.12));
text('primary button: ink on amber', color('cc-amber-ink'), color('cc-amber'));
text('amber outline vs surface (non-text 3:1)', color('cc-amber'), surface, 3);
text('cyan outline vs surface (non-text 3:1)', color('cc-cyan'), surface, 3);
text('rose outline vs surface (non-text 3:1)', color('cc-rose'), surface, 3);

let bad = 0;
for (const p of pairs) {
  const r = ratio(p.fg, p.bg);
  const ok = r >= p.min;
  if (!ok) bad++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${p.min})  ${p.label}`);
}
// the TS mirror carries the same values
const mirror = { amber: 'cc-amber', cyan: 'cc-cyan', rose: 'cc-rose', violet: 'cc-violet', green: 'cc-green', surface: 'cc-surface', text: 'cc-text', textDim: 'cc-text-dim', amberInk: 'cc-amber-ink' };
for (const [k, token] of Object.entries(mirror)) {
  const m = new RegExp(`${k}:\\s*'(#[0-9a-fA-F]{6})'`).exec(ts.slice(ts.indexOf('councilChamber')));
  if (!m || m[1].toLowerCase() !== val(token).toLowerCase()) {
    bad++;
    console.log(`FAIL  tokens.ts councilChamber.${k} does not mirror --${token}`);
  }
}
console.log(bad ? `\n${bad} contrast or mirror problem(s)` : `\ncontrast OK: ${pairs.length} pairs at AA, tokens.ts mirrors tokens.css`);
process.exit(bad ? 1 : 0);
