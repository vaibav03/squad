import type { LayerName, Op, Recipe } from './types';

const LAYERS: LayerName[] = ['bg', 'mid', 'fg'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Every sprite name an op draws. */
export function opSprites(op: Op): string[] {
  if (op.op === 'tile' || op.op === 'put') return [op.sprite];
  if (op.op === 'span') return [op.left, op.mid, op.right];
  return [];
}

/** Pack-relative files the recipe reads, sorted (what the importer extracts and what dry-run lists). */
export function neededFiles(r: Recipe): string[] {
  const used = new Set<string>();
  for (const l of LAYERS)
    for (const op of r.layers[l] ?? []) for (const s of opSprites(op)) used.add(s);
  const files = new Set<string>();
  for (const s of used) {
    const sp = r.sprites[s];
    const f = sp && r.sheets[sp.sheet];
    if (f) files.add(f);
  }
  return [...files].sort();
}

/** Throws one Error listing every problem, or returns the recipe typed. Pure: no pixels, no filesystem. */
export function validateRecipe(raw: unknown): Recipe {
  const errs: string[] = [];
  const bad = (m: string) => errs.push(m);
  const r = raw as Recipe;
  if (!r || typeof r !== 'object') throw new Error('recipe: not an object');
  if (!r.id || !/^[a-z0-9-]+$/.test(r.id)) bad('id must be kebab-case');
  if (!r.scene) bad('scene is required');
  if (!r.credit || !/LimeZu/.test(r.credit)) bad('credit must name LimeZu');
  if (
    !Array.isArray(r.size) ||
    r.size.length !== 2 ||
    r.size.some((n) => !Number.isInteger(n) || n <= 0)
  )
    bad('size must be [w,h] positive integers');
  const [W, H] = Array.isArray(r.size) ? r.size : [0, 0];
  const sheets = r.sheets ?? {};
  for (const [k, p] of Object.entries(sheets)) {
    if (typeof p !== 'string' || p.startsWith('/') || p.includes('..') || p.includes('\\'))
      bad(`sheet ${k}: path must be pack-relative with forward slashes`);
    else if (!/\.png$/i.test(p)) bad(`sheet ${k}: only .png sheets are read`);
  }
  const sprites = r.sprites ?? {};
  for (const [k, s] of Object.entries(sprites)) {
    if (!(s.sheet in sheets)) bad(`sprite ${k}: unknown sheet ${s.sheet}`);
    for (const f of ['x', 'y', 'w', 'h'] as const)
      if (!Number.isInteger(s[f]) || s[f] < 0 || (f === 'w' || f === 'h' ? s[f] === 0 : false))
        bad(`sprite ${k}: ${f} must be a non-negative integer (w and h above 0)`);
  }
  if (!r.layers || !Array.isArray(r.layers.bg) || r.layers.bg.length === 0)
    bad('layers.bg is required');
  for (const l of LAYERS) {
    for (const [i, op] of (r.layers?.[l] ?? []).entries()) {
      const where = `layers.${l}[${i}]`;
      if (!['tile', 'put', 'span', 'fill'].includes(op.op)) {
        bad(`${where}: unknown op ${String((op as { op?: unknown }).op)}`);
        continue;
      }
      for (const s of opSprites(op)) if (!(s in sprites)) bad(`${where}: unknown sprite ${s}`);
      if (op.op === 'fill' && !HEX.test(op.color)) bad(`${where}: color must be #rrggbb`);
      if (op.op === 'put' && sprites[op.sprite]) {
        const sp = sprites[op.sprite]!;
        if (op.x >= W || op.y >= H || op.x + sp.w <= 0 || op.y + sp.h <= 0)
          bad(`${where}: ${op.sprite} is outside the room`);
      }
      if (op.op === 'span') {
        const hs = [op.left, op.mid, op.right].map((n) => sprites[n]?.h);
        if (new Set(hs).size > 1) bad(`${where}: span sprites must share one height`);
      }
    }
  }
  const L = r.layout;
  if (!L) bad('layout is required');
  else {
    if (!Array.isArray(L.seats) || L.seats.length !== 3) bad('layout.seats needs 3 anchors');
    const pts = [...(L.seats ?? []), L.chair, L.entry];
    for (const p of pts)
      if (!p || !(p.x >= 0 && p.x < W && p.y >= 0 && p.y < H))
        bad('layout anchors must sit inside the room');
    if (!Array.isArray(L.rowX) || L.rowX.length !== 3) bad('layout.rowX needs 3 values');
  }
  if (errs.length) throw new Error(`recipe ${r.id ?? '?'}: ${errs.join('; ')}`);
  return r;
}
