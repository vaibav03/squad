import { Raster } from '../../pixel/raster';
import { drawText } from '../../pixel/font';
import { rng } from '../../pixel/rng';
import { put, type AssetLib } from '../../assets';
import type { PaintOpts } from '../../contract';
import { easeOut, progress } from '../../curves';
import {
  callPortrait,
  castFrame,
  doorRing,
  hornsOn,
  lightPool,
  lookOf,
  paintLbBubbles,
  unlit,
  type LbState,
} from '../../art/landmark-b-kit';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 112, y: 124 };
const FLOOR_Y = 112;
const BOARD = { x: 130, y: 90 }; // anchor: bottom centre of the chalkboard
/** The worked line on the board: step 2 is the planted mistake (2X = 14 should be 2X = 8). */
export const WORKED = ['2X+3=11', '2X=14', 'X=7'] as const;
const CANDLES = [
  [34, FLOOR_Y - 2],
  [196, FLOOR_Y - 2],
  [172, FLOOR_Y - 2],
] as const;

function room(): Raster {
  const r = new Raster(INT_W, INT_H);
  const rand = rng(11);
  r.rect(0, 0, INT_W, FLOOR_Y, 'leaf-dark');
  // rock face: dither bands and cracks
  r.dither(0, 20, INT_W, 40, 'sky-deep', 0);
  r.dither(0, 60, INT_W, 52, 'hill-near', 0);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rand() * INT_W);
    const y = 10 + Math.floor(rand() * 96);
    r.hline(x, y, 3 + Math.floor(rand() * 5), 'hill-near');
    r.px(x + 1, y + 1, 'ink');
  }
  // cave mouth glimpse at back: moonlit slit
  r.rect(98, 40, 28, 50, 'ink');
  r.rect(102, 34, 20, 6, 'ink');
  r.rect(106, 30, 12, 4, 'ink');
  r.dither(98, 70, 28, 20, 'roof-shade', 0);
  // side walls close in
  r.poly(
    [
      [0, 0],
      [34, 0],
      [18, 50],
      [26, FLOOR_Y],
      [0, FLOOR_Y],
    ],
    'ink',
  );
  r.poly(
    [
      [INT_W, 0],
      [INT_W - 34, 0],
      [INT_W - 18, 50],
      [INT_W - 26, FLOOR_Y],
      [INT_W, FLOOR_Y],
    ],
    'ink',
  );
  r.dither(18, 20, 24, 70, 'sky-deep', 0);
  r.dither(INT_W - 42, 20, 24, 70, 'sky-deep', 1);
  // stalactites
  for (let x = 6; x < INT_W; x += 11 + Math.floor(rand() * 8)) {
    const h = 8 + Math.floor(rand() * 18);
    r.poly(
      [
        [x - 4, 0],
        [x + 4, 0],
        [x, h],
      ],
      'hill-near',
    );
    r.poly(
      [
        [x - 1, 0],
        [x + 4, 0],
        [x + 1, Math.max(2, h - 4)],
      ],
      'ink',
    );
    r.px(x, h, 'leaf-lit');
  }
  // floor: packed earth with scattered pebbles
  r.rect(0, FLOOR_Y, INT_W, INT_H - FLOOR_Y, 'hill-near');
  r.hline(0, FLOOR_Y, INT_W, 'wood-lit');
  r.hline(0, FLOOR_Y + 1, INT_W, 'wood');
  r.hline(0, FLOOR_Y + 2, INT_W, 'wood-dark');
  r.dither(0, FLOOR_Y + 3, INT_W, 6, 'ground', 0);
  for (let i = 0; i < 24; i++)
    r.px(Math.floor(rand() * INT_W), FLOOR_Y + 2 + Math.floor(rand() * 12), 'hill-mid');
  // glowing sigil on the floor in front of the board
  r.ring(112, 120, 40, 5, 'roof-wine');
  r.outline('ink');
  return r;
}

let roomCache: Raster | null = null;

function chalkText(r: Raster, x: number, y: number, t: string): void {
  drawText(r, x, y, t, 'cloud-hi');
}

function easel(r: Raster, a: AssetLib, s: LbState, o: PaintOpts, live: boolean): void {
  const b = a.image('prop.chalkboard');
  r.rect(BOARD.x - 20, BOARD.y, 3, FLOOR_Y - BOARD.y, 'wood-dark');
  r.rect(BOARD.x + 18, BOARD.y, 3, FLOOR_Y - BOARD.y, 'wood-dark');
  put(r, b, BOARD.x, BOARD.y);
  const bx = BOARD.x - 24;
  const by = BOARD.y - 31;
  chalkText(r, bx + 6, by + 4, WORKED[0]);
  chalkText(r, bx + 6, by + 11, WORKED[1]);
  chalkText(r, bx + 6, by + 18, WORKED[2]);
  if (!live) return;
  const m = s.chalk.mark;
  if (m === 'cross') {
    // the sneaky red underline grows under step 2 (calm: appears whole)
    const full = 19;
    const w = o.calm
      ? full
      : Math.max(1, Math.round(full * easeOut(progress(o.t, s.chalk.since, 320))));
    r.hline(bx + 6, by + 16, w, 'alert');
    put(r, a.image('prop.chalk-cross'), bx + 38, by + 16);
  } else if (m === 'tick') {
    r.hline(bx + 6, by + 16, 19, 'ok');
    put(r, a.image('prop.chalk-tick'), bx + 38, by + 16);
  }
}

function candle(r: Raster, x: number, y: number, frame: number, lit: boolean): void {
  r.rect(x - 1, y - 4, 3, 4, 'wall-lit');
  r.hline(x - 1, y - 4, 3, 'cloud-hi');
  r.px(x, y - 5, 'ink');
  if (!lit) return;
  r.px(x, y - 6 - frame, 'glow-core');
  r.px(x, y - 5 - frame, 'glow');
}

/** Interior cutaway (224x128): the cavern with the chalkboard and the TA who hid a mistake in it. */
export function paintInterior(s: LbState, o: PaintOpts): Raster {
  const look = lookOf(s);
  const a = o.assets;
  roomCache ??= room();
  const r = roomCache.clone();
  const flick = o.calm ? 0 : Math.floor((o.t / 1000) * 3) % 2;
  CANDLES.forEach(([x, y], i) => candle(r, x, y, (flick + i) % 2, look.awake));
  easel(r, a, s, o, look.awake);
  if (!look.locked) {
    const f = castFrame(a, 'ta', s.occupant, o);
    const flip = s.occupant === 'studying'; // scribbling at the board with his back to you
    const fx = 84;
    put(r, f, fx, FLOOR_Y - 1, { flipX: flip });
    hornsOn(r, f, fx, FLOOR_Y - 1, flip);
  }
  // eyes in the dark
  if (look.awake) {
    for (const [ex, ey] of [
      [100, 56],
      [118, 70],
    ] as const) {
      r.px(ex, ey, 'ember');
      r.px(ex + 3, ey, 'ember');
    }
  }
  if (!look.awake) {
    unlit(r);
    return r;
  }
  const k = o.calm ? 1 : 0.8 + 0.2 * flick;
  for (const [x, y] of CANDLES) lightPool(r, x, y - 8, 22, 18, 'ember', 0.55 * k, 4);
  lightPool(r, BOARD.x, BOARD.y - 16, 30, 22, 'violet', 0.2, 3);
  r.ellipse(112, FLOOR_Y + 8, 46, 5, 'violet', 0.16);
  r.rect(0, 40, INT_W, FLOOR_Y - 40, 'ember', 0.05);
  if (s.ring) doorRing(r, a, 112, FLOOR_Y + 8, o);
  if (s.portrait) callPortrait(r, a, 'ta', 8, 8, o);
  paintLbBubbles(r, s, o, 52, FLOOR_Y - 36, 30, 3);
  return r;
}
