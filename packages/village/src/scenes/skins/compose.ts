import { Raster } from '../pixel/raster';
import type { LayerName, Op, Recipe, SpriteRef } from './types';

/** Reads one sheet by its recipe key. The importer supplies a zip-backed loader, tests supply synthetic sheets. */
export type SheetLoader = (key: string) => Raster;

const LAYERS: LayerName[] = ['bg', 'mid', 'fg'];

function hexRgb(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Rectangles that fall outside their sheet (dry-run and compose both refuse them). */
export function checkSpriteBounds(
  recipe: Recipe,
  dims: (sheetKey: string) => { w: number; h: number } | undefined,
): string[] {
  const out: string[] = [];
  for (const [name, s] of Object.entries(recipe.sprites)) {
    const d = dims(s.sheet);
    if (!d) continue;
    if (s.x + s.w > d.w || s.y + s.h > d.h)
      out.push(
        `sprite ${name}: ${s.w}x${s.h} at ${s.x},${s.y} is outside ${recipe.sheets[s.sheet]} (${d.w}x${d.h})`,
      );
  }
  return out;
}

/** Compose the recipe's layers at the scene's native size. Pure and deterministic: same sheets, same pixels. */
export function compose(recipe: Recipe, load: SheetLoader): Partial<Record<LayerName, Raster>> {
  const [W, H] = recipe.size;
  const sheets = new Map<string, Raster>();
  const sheet = (k: string): Raster => {
    let s = sheets.get(k);
    if (!s) {
      s = load(k);
      sheets.set(k, s);
    }
    return s;
  };
  const cut = new Map<string, Raster>();
  const sprite = (name: string): Raster => {
    let c = cut.get(name);
    if (!c) {
      const s: SpriteRef | undefined = recipe.sprites[name];
      if (!s) throw new Error(`recipe ${recipe.id}: unknown sprite ${name}`);
      const sh = sheet(s.sheet);
      if (s.x + s.w > sh.w || s.y + s.h > sh.h)
        throw new Error(
          `recipe ${recipe.id}: sprite ${name} is outside its sheet (${sh.w}x${sh.h})`,
        );
      c = sh.crop(s.x, s.y, s.w, s.h);
      cut.set(name, c);
    }
    return c;
  };

  const run = (r: Raster, op: Op): void => {
    if (op.op === 'put') {
      r.blit(sprite(op.sprite), op.x, op.y, op.flip ? { flipX: true } : {});
    } else if (op.op === 'tile') {
      const t = sprite(op.sprite);
      for (let y = 0; y < op.h; y += t.h)
        for (let x = 0; x < op.w; x += t.w) {
          const cw = Math.min(t.w, op.w - x);
          const ch = Math.min(t.h, op.h - y);
          r.blit(cw === t.w && ch === t.h ? t : t.crop(0, 0, cw, ch), op.x + x, op.y + y);
        }
    } else if (op.op === 'span') {
      const [l, m, rt] = [sprite(op.left), sprite(op.mid), sprite(op.right)];
      r.blit(l, op.x, op.y);
      const x1 = op.x + op.w - rt.w;
      for (let x = op.x + l.w; x < x1; x += m.w) {
        const cw = Math.min(m.w, x1 - x);
        r.blit(cw === m.w ? m : m.crop(0, 0, cw, m.h), x, op.y);
      }
      r.blit(rt, x1, op.y);
    } else {
      const [cr, cg, cb] = hexRgb(op.color);
      const a = op.alpha ?? 1;
      for (let y = Math.max(0, op.y); y < Math.min(H, op.y + op.h); y++)
        for (let x = Math.max(0, op.x); x < Math.min(W, op.x + op.w); x++) {
          const i = (y * W + x) * 4;
          const da = r.data[i + 3]! / 255;
          const oa = a + da * (1 - a);
          r.data[i] = (cr * a + r.data[i]! * da * (1 - a)) / oa;
          r.data[i + 1] = (cg * a + r.data[i + 1]! * da * (1 - a)) / oa;
          r.data[i + 2] = (cb * a + r.data[i + 2]! * da * (1 - a)) / oa;
          r.data[i + 3] = oa * 255;
        }
    }
  };

  const out: Partial<Record<LayerName, Raster>> = {};
  for (const l of LAYERS) {
    const ops = recipe.layers[l];
    if (!ops || ops.length === 0) continue;
    const r = new Raster(W, H);
    for (const op of ops) run(r, op);
    out[l] = r;
  }
  return out;
}
