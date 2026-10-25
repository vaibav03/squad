import { Raster } from '../../pixel/raster';
import { drawTextCentered, textWidth } from '../../pixel/font';
import { put, type AssetLib } from '../../assets';
import type { PaintOpts } from '../../contract';
import { triangle } from '../../model/base';
import {
  callPortrait,
  castFrame,
  doorRing,
  lookOf,
  paintLbBubbles,
  lightPool,
  unlit,
  type LbState,
} from '../../art/landmark-b-kit';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 124 };
const FLOOR_Y = 112;
const ORB = { x: 112, y: 70 };

/** Orb pulse 0..1: calm is steady, working is quicker. */
export function orbPulse(s: LbState, o: PaintOpts): number {
  if (o.calm) return 0.5;
  const busy = s.occupant === 'studying' || s.occupant === 'in_call';
  return triangle(o.t, busy ? 1800 : 3200);
}

function room(a: AssetLib): Raster {
  const r = new Raster(INT_W, INT_H);
  // stone drum wall
  r.rect(0, 0, INT_W, FLOOR_Y, 'wall-shade');
  for (let y = 9; y < FLOOR_Y; y += 9) {
    r.hline(0, y, INT_W, 'hill-mid');
    const off = (y / 9) % 2 === 0 ? 0 : 6;
    for (let x = off; x < INT_W; x += 12) r.vline(x, y - 8, 8, 'hill-mid');
  }
  r.dither(0, 0, INT_W, 18, 'hill-mid', 0);
  r.rect(0, 0, INT_W, 5, 'wall-mid');
  r.hline(0, 5, INT_W, 'ink');
  // the observatory slit: a tall arch onto the night sky
  const ax = 70;
  const aw = 84;
  r.rect(ax, 10, aw, 66, 'sky-deep');
  r.rect(ax + 10, 4, aw - 20, 6, 'sky-deep');
  r.rect(ax + 24, 0, aw - 48, 4, 'sky-deep');
  r.dither(ax, 44, aw, 32, 'sky-mid', 0);
  r.dither(ax, 60, aw, 16, 'sky-low', 1);
  r.ellipse(ax + 64, 24, 6, 6, 'moon');
  r.ellipse(ax + 62, 23, 5, 5, 'cloud-hi', 1);
  r.ellipse(ax + 67, 22, 5, 5, 'sky-deep');
  r.frame(ax - 1, 9, aw + 2, 68, 'wall-lit');
  r.hline(ax - 3, 77, aw + 6, 'wall-lit');
  r.hline(ax - 3, 78, aw + 6, 'wall-shade');
  // star charts and scrolls pinned to the wall
  for (const [x, y] of [
    [14, 22],
    [28, 30],
    [186, 24],
  ] as const) {
    const m = a.image('prop.map');
    r.rect(x - 1, y - 1, m.r.w + 2, m.r.h + 2, 'wood-dark');
    r.blit(m.r, x, y);
  }
  r.rect(0, 0, 1, INT_H, 'ink');
  r.rect(INT_W - 1, 0, 1, INT_H, 'ink');
  // floor: slate with a violet inlay ring under the orb
  r.rect(0, FLOOR_Y, INT_W, INT_H - FLOOR_Y, 'wall-shade');
  r.hline(0, FLOOR_Y, INT_W, 'wall-lit');
  r.hline(0, FLOOR_Y + 8, INT_W, 'hill-mid');
  for (let x = 0; x < INT_W; x += 24) r.vline(x, FLOOR_Y + 1, 7, 'hill-mid');
  for (let x = 12; x < INT_W; x += 24) r.vline(x, FLOOR_Y + 9, 7, 'hill-mid');
  r.ring(112, 108, 34, 5, 'violet');
  return r;
}

let roomCache: Raster | null = null;

function plinth(r: Raster, label: string, live: boolean): void {
  r.rect(98, 84, 28, 6, 'wood-lit');
  r.hline(98, 84, 28, 'glow');
  r.rect(100, 90, 24, 22, 'wood-dark');
  r.vline(100, 90, 22, 'wood');
  r.rect(102, 92, 20, 12, 'ink');
  r.frame(102, 92, 20, 12, live ? 'violet' : 'wall-shade');
  r.px(112, 97, live ? 'violet' : 'wall-shade');
  if (label) {
    // plate across the plinth front carries the chalk label ("ch5 next?")
    const w = textWidth(label) + 6;
    const x = 112 - Math.floor(w / 2);
    r.rect(x, 93, w, 9, 'ink');
    r.frame(x, 93, w, 9, live ? 'violet' : 'wall-shade');
    drawTextCentered(r, 112, 95, label, live ? 'glow-core' : 'wall-shade');
  }
}

/** Interior cutaway (224x128): star room with telescope, charts, brass plinth and a pulsing orb. */
export function paintInterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const a = o.assets;
  roomCache ??= room(a);
  const r = roomCache.clone();
  // twinkling stars in the opening (fx.star sheets, 2 fps, staggered; steady in calm)
  const starAt = [
    [90, 20, 1],
    [104, 40, 2],
    [126, 16, 3],
    [140, 46, 4],
    [96, 62, 2],
    [150, 28, 1],
  ] as const;
  starAt.forEach(([x, y, k], i) => {
    const n = o.calm ? 1 : Math.floor((o.t / 1000) * 2) + i;
    put(r, a.sheet(`fx.star-${k}`, n), x, y);
  });
  put(r, a.image('prop.bookshelf'), 30, FLOOR_Y);
  put(r, a.image('prop.books'), 52, FLOOR_Y);
  put(r, a.image('prop.telescope'), 188, FLOOR_Y);
  put(r, a.image('prop.scroll'), 206, FLOOR_Y - 1);
  put(
    r,
    a.sheet('ui.lantern-street', look.awake && !o.calm ? Math.floor((o.t / 1000) * 3) : 1),
    168,
    34,
  );
  plinth(r, look.awake ? s.chalk.text.toUpperCase() : '', look.awake);
  if (!look.locked) put(r, castFrame(a, 'chairman', s.occupant, o), 72, FLOOR_Y - 1);
  // the orb: shell, iris, core
  const p = orbPulse(s, o);
  r.ellipse(ORB.x, ORB.y, 9, 9, look.awake ? 'violet' : 'wall-shade');
  r.ellipse(ORB.x, ORB.y, 6, 6, look.awake ? 'cloud-hi' : 'wall-mid');
  r.ellipse(ORB.x, ORB.y, 3, 3, look.awake ? 'glow-core' : 'wall-lit');
  r.px(ORB.x - 5, ORB.y - 5, 'wall-lit');
  r.px(ORB.x - 4, ORB.y - 6, 'wall-lit');
  if (!look.awake) {
    unlit(r);
    return r;
  }
  r.glow(ORB.x, ORB.y, 22 + Math.round(p * 4), 'violet', 0.3 + 0.25 * p, 4);
  r.glow(ORB.x, ORB.y, 9, 'glow-core', 0.25 + 0.2 * p, 3);
  for (let i = 0; i < 3; i++) {
    const ang = (o.calm ? 0.5 : (o.t / 7000) * Math.PI * 2) + (i * Math.PI * 2) / 3;
    r.px(
      ORB.x + Math.round(Math.cos(ang) * 16),
      ORB.y + Math.round(Math.sin(ang) * 6),
      i ? 'cloud-hi' : 'glow-core',
    );
  }
  // the one warm anchor: a lantern pool on the right wall and floor
  lightPool(r, 173, 44, 14, 14, 'glow', 0.45, 3);
  lightPool(r, 176, FLOOR_Y - 2, 22, 5, 'glow', 0.3, 3);
  // starlight pooling on the floor beneath the opening
  r.ellipse(112, FLOOR_Y + 6, 40, 4, 'violet', 0.12 + 0.1 * p);
  if (s.ring) doorRing(r, a, 112, FLOOR_Y + 12, o);
  if (s.portrait) callPortrait(r, a, 'chairman', 8, 40, o);
  paintLbBubbles(r, s, o, 84, FLOOR_Y - 36, 20, 3);
  return r;
}
