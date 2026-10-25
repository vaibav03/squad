import { Raster } from '../pixel/raster';
import { DIM } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import type { PaintOpts } from '../contract';
import { put } from '../assets';
import { easeOut } from '../curves';
import { triangle, glowNow, type BaseState } from '../model/base';
import { plankText, styleFor, type ChapterStyle, type Remap } from './style';

/** House sprite is 128x133; 16 px margins carry props, 30 px of headroom carry the chimney smoke. */
export const EXT_W = 160;
export const EXT_H = 163;
const SX = 16; // sprite left in the box
const SY = EXT_H - 133; // sprite top in the box
export const DOOR = { x: SX + 40, y: EXT_H - 1 } as const;
const CHIMNEY = { x: SX + 105, y: SY + 2 } as const;
const WINDOW = { x: SX + 102, y: SY + 69 } as const;

const variantCache = new WeakMap<Raster, Map<string, Raster>>();
function derive(src: Raster, key: string, f: (r: Raster) => Raster): Raster {
  let m = variantCache.get(src);
  if (!m) variantCache.set(src, (m = new Map()));
  let r = m.get(key);
  if (!r) m.set(key, (r = f(src.clone())));
  return r;
}
export const dimmed = (r: Raster): Raster => derive(r, 'dim', (c) => c.remap(DIM));
/** Palette swap on the roof only (rows above the eave), so wall stains keep their colours. */
const ROOF_ROWS = 39;
export const swapped = (r: Raster, key: string, map: Remap, rows = ROOF_ROWS): Raster =>
  Object.keys(map).length
    ? derive(r, `swap:${key}:${rows}`, (c) => {
        const keep = r.crop(0, rows, r.w, r.h - rows);
        c.remap(map);
        c.rect(0, rows, c.w, c.h - rows, null);
        return c.blit(keep, 0, rows);
      })
    : r;

/** Distance (px, 8-neighbour) from a sprite's silhouette: the rim glow of mastery. */
const HALO_R = 7;
const fields = new WeakMap<Raster, Uint8Array>();
function distanceField(spr: Raster): Uint8Array {
  let d = fields.get(spr);
  if (d) return d;
  d = new Uint8Array(EXT_W * EXT_H).fill(255);
  let frontier: number[] = [];
  for (let y = 0; y < spr.h; y++) {
    for (let x = 0; x < spr.w; x++) {
      if (!spr.isOpaque(x, y)) continue;
      d[(y + SY) * EXT_W + x + SX] = 0;
      frontier.push(x + SX, y + SY);
    }
  }
  for (let step = 1; step <= HALO_R; step++) {
    const next: number[] = [];
    for (let i = 0; i < frontier.length; i += 2) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = frontier[i]! + dx;
          const ny = frontier[i + 1]! + dy;
          if (nx < 0 || ny < 0 || nx >= EXT_W || ny >= EXT_H) continue;
          const k = ny * EXT_W + nx;
          if (d[k] === 255) {
            d[k] = step;
            next.push(nx, ny);
          }
        }
      }
    }
    frontier = next;
  }
  fields.set(spr, d);
  return d;
}

function rimGlow(r: Raster, spr: Raster, g: number, o: PaintOpts): void {
  // a stepped light pool: solid ring, 2 px checker, then a sparse 2 px checker. No smooth blur.
  const steps = g < 0.34 ? 1 : g < 0.67 ? 2 : 3;
  const a = o.calm ? 1 : 0.92 + 0.08 * triangle(o.t, 3200);
  const d = distanceField(spr);
  for (let y = 0; y < EXT_H; y++) {
    for (let x = 0; x < EXT_W; x++) {
      const v = d[y * EXT_W + x]!;
      if (v === 0 || v > HALO_R) continue;
      const checker = (((x >> 1) + (y >> 1)) & 1) === 0;
      if (v <= 2) r.px(x, y, 'glow', 0.42 * a);
      else if (steps >= 2 && v <= 5 && checker) r.px(x, y, 'glow', 0.34 * a);
      else if (steps >= 3 && v <= 7 && checker && (((x >> 2) + (y >> 2)) & 1) === 0) {
        r.px(x, y, 'ember', 0.3 * a);
      }
    }
  }
}

/** Five small pips hung under the eave, inside the hut's width: mastery as progress, never a number. */
function pips(r: Raster, o: PaintOpts, lit: number): void {
  const y = SY + 40;
  for (let i = 0; i < 5; i++) {
    const x = SX + 36 + (i - 2) * 7;
    if (i >= lit) {
      r.px(x, y + 1, 'wood-dark');
      continue;
    }
    const tw = o.calm ? 1 : 0.8 + 0.2 * triangle(o.t + i * 380, 2000);
    r.glow(x, y + 1, 5, 'glow', 0.4 * tw, 3);
    r.rect(x - 1, y, 3, 3, 'ink');
    r.rect(x, y, 1, 2, 'glow');
    r.px(x, y, 'glow-core');
    r.px(x, y + 2, 'glow');
  }
}

/** Window dressing per chapter: curtains over the dark pane, or a flower box under it. */
function dressWindow(r: Raster, o: PaintOpts, st: ChapterStyle, open: boolean, lit: boolean): void {
  if (st.curtain && !lit) {
    const c = o.assets.image('prop.window-curtained');
    r.blit(open ? c.r : dimmed(c.r), WINDOW.x - 3, WINDOW.y + 2);
  }
  if (st.flowerBox) {
    const y = WINDOW.y + 13;
    r.rect(WINDOW.x - 4, y, 12, 3, open ? 'wood' : 'wood-dark');
    r.hline(WINDOW.x - 4, y + 2, 12, 'wood-dark');
    for (const [dx, n] of [
      [-2, 1],
      [1, 2],
      [4, 3],
    ] as const) {
      const f = o.assets.image(`prop.flower-${n}`);
      put(r, open ? f : { ...f, r: dimmed(f.r) }, WINDOW.x + dx, y);
    }
  }
}

/**
 * Exterior (160x176): the composed hut, varied per chapter by a roof swap and two props. Open =
 * dark art with the lit variant crossfaded over it while the expert is awake; dim = the lit art
 * through DIM; locked = dark plus a padlock. Mastery is a rim glow plus a growing row of lanterns.
 */
export function paintExterior(s: BaseState, o: PaintOpts): Raster {
  const r = new Raster(EXT_W, EXT_H);
  const A = o.assets;
  const st = styleFor(s.instance);
  const key = String(st.look);
  const locked = s.access === 'locked';
  const open = s.access === 'open';
  const lit = open && s.windowLit;
  const g = glowNow(s, o);
  const nPips = Math.max(0, Math.min(5, Math.round(g * 5)));

  const darkI = A.image('house.hut', 'dark');
  const litI = A.image('house.hut', 'lit');
  const dark = swapped(darkI.r, key, st.roof);
  const bright = swapped(litI.r, key, st.roof);
  const base = locked ? dimmed(dark) : open ? dark : dimmed(bright);

  if (open) rimGlow(r, base, g, o);

  // props beside the house (behind it on the left, in front on the right)
  const prop = (p: { id: string; x: number }): void => {
    const a = p.id === 'prop.lamp-post' && lit ? A.image(p.id, 'lit') : A.image(p.id);
    put(r, open ? a : { ...a, r: dimmed(a.r) }, p.x, EXT_H - 1);
  };
  prop(st.propL);
  put(r, { ...darkI, r: base }, SX + darkI.ax, EXT_H - 1);
  if (lit) {
    const f = o.calm ? 1 : 0.85 + 0.15 * easeOut(triangle(o.t, 4000));
    put(r, { ...litI, r: bright }, SX + litI.ax, EXT_H - 1, { alpha: f });
  }
  dressWindow(r, o, st, open, lit);
  if (st.extra) prop(st.extra);
  prop(st.propR);

  // the chapter on the plank
  const label = plankText(s.sign || s.title, textWidth);
  drawText(r, SX + 26, SY + 27, label, 'ink');

  if (locked) {
    put(r, A.image('ui.padlock'), DOOR.x, DOOR.y - 44);
    // state in words, not only colour
    const w = textWidth('LOCKED') + 4;
    r.rect(DOOR.x - (w >> 1), DOOR.y - 38, w, 9, 'ink');
    r.frame(DOOR.x - (w >> 1), DOOR.y - 38, w, 9, 'wall-shade');
    drawText(r, DOOR.x - (w >> 1) + 2, DOOR.y - 36, 'LOCKED', 'cloud-hi');
    return r;
  }
  if (lit) {
    const f = o.calm ? 1 : 0.85 + 0.15 * easeOut(triangle(o.t, 4000));
    r.glow(WINDOW.x + 5, WINDOW.y + 6, 15, 'glow', 0.5 * f, 4);
    r.ellipse(DOOR.x, EXT_H - 2, 22, 3, 'glow', 0.14 * f);
    const frame = o.calm ? 3 : Math.floor(o.t / 200) % 8;
    put(r, A.sheet('fx.chimney-smoke', frame), CHIMNEY.x, CHIMNEY.y, { flipX: st.smokeFlip });
  }
  if (open && s.ring) {
    const p = o.calm ? 0.5 : (o.t % 1600) / 1600;
    const ring = A.sheet('ui.door-ring', Math.min(2, Math.floor(p * 3)));
    put(r, ring, DOOR.x, EXT_H - 4, { alpha: o.calm ? 0.8 : 1 - 0.7 * easeOut(p) });
  }
  if (open) pips(r, o, nPips);
  return r;
}
