import { Raster } from '../pixel/raster';
import { DIM } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import type { PaintOpts } from '../contract';
import { put } from '../assets';
import { easeOut } from '../curves';
import { triangle, glowNow, type BaseState } from '../model/base';
import { plankText, styleFor, type Remap } from './style';

/** House sprite is 128x133; 16 px margins carry props, 43 px of headroom carry smoke and lanterns. */
export const EXT_W = 160;
export const EXT_H = 176;
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
  const k = 0.08 + 0.45 * g;
  const pulse = o.calm ? 1 : 0.95 + 0.05 * triangle(o.t, 3200);
  const d = distanceField(spr);
  const bands = [0.8, 0.5, 0.3, 0.14];
  for (let y = 0; y < EXT_H; y++) {
    for (let x = 0; x < EXT_W; x++) {
      const v = d[y * EXT_W + x]!;
      if (v === 0 || v > HALO_R) continue;
      const band = Math.min(3, Math.floor((v - 1) / 2));
      r.px(x, y, band < 2 ? 'glow' : 'ember', k * pulse * bands[band]!);
    }
  }
}

/** Five sky lanterns above the roof: lit ones flicker, the rest hang cold. Progress, never a number. */
function lanterns(r: Raster, o: PaintOpts, lit: number, flip: boolean): void {
  const cx = EXT_W / 2 + (flip ? 14 : -14);
  for (let i = 0; i < 5; i++) {
    const x = Math.round(cx + (i - 2) * 14);
    const on = i < lit;
    const bob = o.calm ? 0 : Math.floor(((o.t + i * 330) / 1000) * 2) % 2;
    const y = 12 + bob + (i % 2);
    const f = o.assets.sheet(
      'ui.lantern-street',
      on ? (o.calm ? 1 : (Math.floor(o.t / 330) + i) % 3) : 0,
    );
    put(r, on ? f : { ...f, r: dimmed(f.r) }, x, y, { alpha: on ? 1 : 0.85 });
    if (on) r.glow(x, y + 9, 9, 'glow', 0.35, 3);
  }
}

function sparkles(r: Raster, o: PaintOpts, g: number): void {
  if (g < 0.6) return;
  const spots: Array<[number, number]> = [
    [6, 100],
    [150, 90],
    [20, 60],
    [140, 62],
    [8, 140],
  ];
  const n = g > 0.9 ? 5 : g > 0.75 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const f = o.assets.sheet(
      `fx.star-${(i % 4) + 1}`,
      o.calm ? 1 : (Math.floor(o.t / 500) + i) % 3,
    );
    put(r, f, spots[i]![0], spots[i]![1]);
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
  const pips = locked ? 0 : Math.max(0, Math.min(5, Math.round(g * 5)));

  const darkI = A.image('house.hut', 'dark');
  const litI = A.image('house.hut', 'lit');
  const dark = swapped(darkI.r, key, st.roof);
  const bright = swapped(litI.r, key, st.roof);
  const base = locked ? dimmed(dark) : open ? dark : dimmed(bright);

  if (!locked) rimGlow(r, base, g, o);

  // props beside the house (behind it on the left, in front on the right)
  const prop = (id: string, x: number): void => {
    const a = id === 'prop.lamp-post' && lit ? A.image(id, 'lit') : A.image(id);
    put(r, open ? a : { ...a, r: dimmed(a.r) }, x, EXT_H - 1);
  };
  prop(st.propL, 14);
  put(r, { ...darkI, r: base }, SX + darkI.ax, EXT_H - 1);
  if (lit) {
    const f = o.calm ? 1 : 0.85 + 0.15 * easeOut(triangle(o.t, 4000));
    put(r, { ...litI, r: bright }, SX + litI.ax, EXT_H - 1, { alpha: f });
  }
  prop(st.propR, EXT_W - 14);

  // the chapter on the plank
  const label = plankText(s.sign || s.title, textWidth);
  drawText(r, SX + 36 - Math.floor(textWidth(label) / 2), SY + 27, label, 'ink');

  if (locked) {
    put(r, A.image('ui.padlock'), DOOR.x, DOOR.y - 36);
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
  if (open) {
    lanterns(r, o, pips, st.smokeFlip);
    sparkles(r, o, g);
  } else if (pips > 0) lanterns(r, o, 0, st.smokeFlip);
  return r;
}
