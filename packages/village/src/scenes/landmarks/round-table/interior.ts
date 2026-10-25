import { Raster } from '../../pixel/raster';
import { drawText, drawTextCentered, textWidth } from '../../pixel/font';
import { rng } from '../../pixel/rng';
import type { PaintOpts } from '../../contract';
import { put, type AssetLib } from '../../assets';
import { easeInOut, easeOut, progress } from '../../curves';
import { frameAt, lanternFrame, triangle, visibleBubbles } from '../../model/base';
import { bubble, bubbleChars } from '../../art/bubble';
import { paintPlanSheet } from '../../art/planSheet';
import { EXPERT, dimmed, planksH, portraitFrame } from '../../art/landmark-a-kit';
import { isChair, seatOf } from '../../council-hall/state';
import type { RoundTableState } from './state';

export const INT_W = 224;
export const INT_H = 128;
export const ENTRY = { x: 90, y: 122 };

/** Seat centres (feet on the line behind the table), the table and the chair's armchair. */
export const SEATS = [
  { x: 36, flip: false },
  { x: 90, flip: false },
  { x: 144, flip: true },
] as const;
const SEAT_FEET = 111;
const TABLE = { cx: 90, cy: 113, rx: 62, ry: 13 };
const CHAIR = { x: 196, feet: 113 };

const PERSONA: Record<string, string> = {
  chill: 'council-chill',
  grind: 'council-hard',
  advisor: 'council-balance',
};
const BY_SEAT = ['council-chill', 'council-hard', 'council-balance'];
export const personaOf = (member: string, seat: number): string =>
  PERSONA[member] ?? BY_SEAT[seat % 3]!;
const DEFAULT_MEMBERS = ['chill', 'grind', 'advisor'] as const;

/** Short plate text for the table front: 'advisor' -> 'ADVISOR'. */
export function plateOf(member: string): string {
  return member.replace(/[-_]/g, ' ').slice(0, 9).toUpperCase();
}

const bgCache = new WeakMap<AssetLib, Raster>();

function roofUnderside(r: Raster): void {
  r.rect(0, 0, INT_W, 26, 'roof-shade');
  for (let k = -10; k <= 10; k++) {
    r.line(90, -16, 90 + k * 14, 26, k % 2 === 0 ? 'roof-wine' : 'wood-dark');
  }
  r.dither(0, 16, INT_W, 6, 'wood-dark', 0);
  r.rect(0, 26, INT_W, 4, 'wood');
  r.hline(0, 26, INT_W, 'wood-lit');
  r.hline(0, 29, INT_W, 'wood-dark');
  for (let x = 0; x < INT_W; x += 8) {
    r.rect(x + 1, 30, 6, 1, 'wood-dark');
    r.px(x + 3, 31, 'wood-dark');
    r.px(x + 4, 31, 'wood-dark');
  }
}

function night(r: Raster): void {
  r.rect(0, 31, INT_W, 60, 'sky-deep');
  r.dither(0, 60, INT_W, 8, 'sky-mid', 0);
  r.rect(0, 68, INT_W, 24, 'sky-mid');
  r.dither(0, 80, INT_W, 6, 'sky-low', 1);
  const rand = rng(9);
  for (let i = 0; i < 34; i++) {
    r.px(
      Math.floor(rand() * INT_W),
      33 + Math.floor(rand() * 34),
      rand() > 0.8 ? 'moon' : 'cloud-lo',
    );
  }
  r.ellipse(186, 46, 6, 6, 'moon');
  r.ellipse(184, 44, 5, 5, 'cloud-hi');
  for (let x = 0; x < INT_W; x++) {
    const h = 74 + Math.round(Math.sin(x / 17) * 4 + Math.sin(x / 6) * 1.2);
    r.vline(x, h, 98 - h, 'hill-mid');
    const h2 = 82 + Math.round(Math.sin(x / 11 + 2) * 3);
    r.vline(x, h2, 98 - h2, 'hill-near');
  }
}

function post(r: Raster, x: number): void {
  r.rect(x, 30, 8, 82, 'wood');
  r.vline(x, 30, 82, 'wood-lit');
  r.vline(x + 7, 30, 82, 'wood-dark');
  r.vline(x + 3, 32, 78, 'wood-lit');
  r.rect(x - 1, 30, 10, 3, 'wood-lit');
  r.hline(x - 1, 32, 10, 'wood-dark');
  r.rect(x - 1, 108, 10, 4, 'wood-lit');
  r.hline(x - 1, 111, 10, 'wood-dark');
}

function balustrade(r: Raster): void {
  r.rect(0, 88, INT_W, 3, 'wood-lit');
  r.hline(0, 90, INT_W, 'wood-dark');
  r.rect(0, 104, INT_W, 4, 'wood');
  r.hline(0, 104, INT_W, 'wood-lit');
  for (let x = 2; x < INT_W; x += 5) {
    r.rect(x, 91, 3, 13, 'wood');
    r.vline(x, 91, 13, 'wood-lit');
  }
  r.rect(0, 108, INT_W, 4, 'wood-dark');
  r.hline(0, 108, INT_W, 'ink');
}

function floor(r: Raster): void {
  planksH(r, 0, 112, INT_W, 16, 'wood', 'wood-dark', undefined, 4, 56);
  r.hline(0, 112, INT_W, 'ink');
  r.dither(0, 113, INT_W, 3, 'wood-dark', 0);
  r.ellipse(TABLE.cx, 122, 80, 8, 'roof-shade');
  r.ellipse(TABLE.cx, 122, 77, 7, 'roof-wine');
  r.ring(TABLE.cx, 122, 70, 6, 'wood-lit');
}

function background(A: AssetLib): Raster {
  const hit = bgCache.get(A);
  if (hit) return hit;
  const r = new Raster(INT_W, INT_H);
  night(r);
  roofUnderside(r);
  for (const x of [0, 62, 152, 216]) post(r, x);
  balustrade(r);
  floor(r);
  // a stool and books by the left post, a plant by the right
  r.rect(204, 100, 9, 10, 'wood-dark');
  r.ellipse(208, 94, 7, 6, 'leaf-dark');
  r.ellipse(206, 92, 4, 3, 'leaf-lit');
  bgCache.set(A, r);
  return r;
}

function armchair(r: Raster): void {
  const x = CHAIR.x;
  r.rect(x - 11, 74, 22, 40, 'wood');
  r.rect(x - 9, 76, 18, 34, 'roof-wine');
  r.rect(x - 9, 76, 18, 3, 'roof-shade');
  r.vline(x - 11, 74, 40, 'wood-lit');
  r.vline(x + 10, 74, 40, 'wood-dark');
  r.px(x - 11, 73, 'glow');
  r.px(x + 10, 73, 'glow');
}

function map(r: Raster, cx: number, cy: number): void {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [cx - 40, cy + 7],
    [cx - 34, cy - 7],
    [cx + 34, cy - 7],
    [cx + 40, cy + 7],
  ];
  r.poly(pts, 'wall-lit');
  r.line(cx - 40, cy + 7, cx - 34, cy - 7, 'wall-mid');
  r.line(cx + 40, cy + 7, cx + 34, cy - 7, 'wall-mid');
  r.hline(cx - 40, cy + 7, 81, 'wall-mid');
  r.hline(cx - 34, cy - 7, 69, 'wall-mid');
  for (const [mx, my] of [
    [-22, -1],
    [-13, -3],
    [6, -4],
    [17, -2],
  ] as const) {
    r.poly(
      [
        [cx + mx - 4, cy + my + 3],
        [cx + mx, cy + my - 2],
        [cx + mx + 4, cy + my + 3],
      ],
      'wall-shade',
    );
    r.px(cx + mx, cy + my - 2, 'wall-lit');
  }
  r.line(cx - 4, cy - 6, cx - 8, cy + 6, 'sky-low');
  const route: ReadonlyArray<readonly [number, number]> = [
    [-30, 4],
    [-17, 2],
    [-6, 4],
    [8, 1],
    [20, 3],
    [32, -3],
  ];
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i]!;
    const b = route[i + 1]!;
    for (let k = 0; k <= 6; k += 2) {
      r.px(
        cx + Math.round(a[0] + ((b[0] - a[0]) * k) / 6),
        cy + Math.round(a[1] + ((b[1] - a[1]) * k) / 6),
        'alert',
      );
    }
  }
  for (const [px_, py_] of route.slice(0, -1)) r.rect(cx + px_, cy + py_ - 1, 2, 2, 'ink');
  r.vline(cx + 32, cy - 7, 6, 'wood-dark');
  r.rect(cx + 33, cy - 7, 4, 3, 'glow');
  r.rect(cx - 25, cy - 4, 53, 7, 'wall-shade');
  r.frame(cx - 25, cy - 4, 53, 7, 'wood-dark');
  drawText(r, cx - 17, cy - 3, 'NEXT TERM', 'wall-lit');
}

function table(r: Raster, s: RoundTableState, plates: { member: string; x: number }[]): void {
  const { cx, cy, rx, ry } = TABLE;
  r.rect(cx - 54, cy + 4, 6, 11, 'wood-dark');
  r.rect(cx + 48, cy + 4, 6, 11, 'wood-dark');
  r.rect(cx - rx, cy, rx * 2 + 1, 7, 'wood-dark');
  r.ellipse(cx, cy + 6, rx, ry - 2, 'wood-dark');
  r.ellipse(cx, cy, rx, ry, 'wood');
  r.ellipse(cx, cy - 1, rx - 2, ry - 2, 'wood-lit');
  r.ellipse(cx, cy - 1, rx - 5, ry - 4, 'wood');
  map(r, cx, cy - 5);
  for (const p of plates) {
    const label = plateOf(p.member);
    const w = textWidth(label) + 4;
    const dissent = s.verdict?.dissenter === p.member;
    r.rect(p.x - Math.floor(w / 2), cy, w, 7, 'ink');
    r.frame(p.x - Math.floor(w / 2), cy, w, 7, dissent ? 'alert' : 'wood-lit');
    drawTextCentered(r, p.x, cy + 1, label, dissent ? 'alert' : 'glow-core');
  }
}

/** Table props that tell the planners apart: tea, a tower of books, a clipboard. */
function props(r: Raster, A: AssetLib): void {
  const y = 109;
  r.rect(SEATS[0].x + 12, y - 3, 5, 4, 'wall-lit');
  r.hline(SEATS[0].x + 12, y - 3, 5, 'cloud-hi');
  r.px(SEATS[0].x + 17, y - 1, 'wall-lit');
  r.px(SEATS[0].x + 14, y - 5, 'cloud-hi');
  put(r, A.image('prop.books'), SEATS[1].x + 28, y + 1);
  put(r, A.image('prop.books'), SEATS[1].x + 28, y - 4);
  const cx = SEATS[2].x - 22;
  r.rect(cx, y - 5, 8, 9, 'wood');
  r.rect(cx + 1, y - 4, 6, 7, 'wall-lit');
  r.hline(cx + 2, y - 2, 4, 'wall-shade');
  r.hline(cx + 2, y, 4, 'wall-shade');
  r.rect(cx + 2, y - 6, 4, 2, 'wall-mid');
}

function lamp(r: Raster, s: RoundTableState, o: PaintOpts, lit: boolean): void {
  const A = o.assets;
  const f = lanternFrame(s, o);
  const kind = s.lantern === 'flicker' ? 'dissent' : 'street';
  const n = s.lantern === 'flicker' ? f : o.calm ? 1 : Math.floor((o.t / 2000) * 3) % 3;
  r.vline(90, 0, 24, 'ink');
  const a = A.sheet(`ui.lantern-${kind}`, n);
  put(r, lit ? a : { ...a, r: dimmed(a.r) }, 90, 24);
}

/** Interior (224x128): the planners around a round table, next semester's map, the chair at its head. */
export function paintInterior(s: RoundTableState, o: PaintOpts): Raster {
  const A = o.assets;
  const open = s.access === 'open';
  const shut = s.access === 'locked';
  const r = (open ? background(A) : dimmed(background(A))).clone();
  const bubbles = visibleBubbles(s, o);
  const thinking = new Set(bubbles.filter((b) => b.b.style === 'thought').map((b) => b.b.who));
  const speakerWho = s.speaker && o.t - s.speaker.since < 1500 ? s.speaker.who : null;
  lamp(r, s, o, open);

  // chair: sits in the armchair, rises on verdict (240 ms ease-out, instant in calm)
  armchair(r);
  const standing = s.verdict !== null && o.t - s.verdict.since < 9000;
  const standT = s.verdict ? (o.calm ? 1 : easeOut(progress(o.t, s.verdict.since, 240))) : 0;
  const rise = standing ? Math.round(6 * standT) : 0;
  const chairFrame = standing
    ? A.frame('chairman', 'talk', frameAt(o.t, 8, o.calm))
    : A.frame('chairman', 'sit', frameAt(o.t, 2, o.calm));
  put(r, chairFrame, CHAIR.x, CHAIR.feet - rise, { flipX: true });
  drawTextCentered(r, CHAIR.x, 117, 'CHAIR', 'wood-lit');

  const seatedMembers = Object.entries(s.seats).map(([m, seat]) => ({ member: m, seat }));
  const plates: { member: string; x: number }[] = [];
  for (let seat = 0; seat < 3; seat++) {
    const member = seatedMembers.find((m) => m.seat === seat)?.member ?? DEFAULT_MEMBERS[seat]!;
    const { x, flip } = SEATS[seat]!;
    const talking = open && speakerWho === member;
    const anim = talking ? 'talk' : thinking.has(member) ? 'idle' : 'sit';
    const n = talking ? frameAt(o.t, 8, o.calm) : frameAt(o.t, 2, o.calm);
    put(r, A.frame(personaOf(member, seat), anim, n), x, SEAT_FEET + (anim === 'sit' ? 0 : -1), {
      flipX: flip,
    });
    plates.push({ member, x });
  }
  table(r, s, plates);
  props(r, A);

  if (open) {
    const a = o.calm ? 1 : 0.85 + 0.15 * triangle(o.t, 4000);
    const col = s.lantern === 'flicker' ? 'alert' : 'glow';
    const f = lanternFrame(s, o);
    r.glow(90, 32, 36, col, (s.lantern === 'flicker' && f === 0 ? 0.25 : 0.42) * a, 4);
    r.glow(TABLE.cx, 110, 66, 'glow', 0.15 * a, 3);
  }
  if (shut) {
    r.rect(0, 88, INT_W, 6, 'wood');
    r.hline(0, 88, INT_W, 'wood-lit');
    r.line(0, 94, INT_W - 1, 89, 'wood-lit');
  }
  if (s.portrait && open) {
    const talking = bubbles.some((v) => v.b.who === EXPERT);
    r.blit(portraitFrame(A, 'council-balance', talking, frameAt(o.t, 8, o.calm)), 196, 34);
  }

  paintBubbles(r, s, o, bubbles);
  paintVerdict(r, s, o);
  paintPlanSheet(r, s, o.t, o.calm, 24, 34);
  return r;
}

const seatX = (i: number): number => SEATS[i]?.x ?? SEATS[1].x;
const HEAD_TIP = SEAT_FEET - 24;

function paintBubbles(
  r: Raster,
  s: RoundTableState,
  o: PaintOpts,
  bubbles: ReturnType<typeof visibleBubbles>,
): void {
  const chars = bubbleChars(
    bubbles.filter((b) => b.b.style !== 'announce' && b.b.who !== EXPERT).length,
  );
  for (const v of bubbles) {
    const w = v.b.who;
    if (v.b.style === 'announce') continue;
    if (w === EXPERT) {
      const art = bubble(v.b.text, v.b.style, 28, 3, 0.5);
      r.blit(art.r, Math.round(CHAIR.x - art.tail.x), 42, { alpha: v.alpha });
      continue;
    }
    const seat = isChair(w) ? 2 : (s.seats[w] ?? seatOf(s.seats, w));
    const ranked = s.slots !== null;
    let x: number = seatX(seat);
    if (ranked && s.slots) {
      const from = s.slots.from.indexOf(w);
      const to = s.slots.to.indexOf(w);
      const fx = seatX(from < 0 ? seat : from);
      const tx = seatX(to < 0 ? seat : to);
      const k = o.calm ? 1 : easeInOut(progress(o.t, s.slots.since, 320));
      x = Math.round(fx + (tx - fx) * k);
    }
    const style = ranked && v.b.style === 'thought' ? 'speech' : v.b.style;
    const art = bubble(v.b.text, style, chars, 3, ranked ? null : 0.5);
    const slotIdx = ranked && s.slots ? Math.max(0, s.slots.to.indexOf(w)) : seat;
    let bx = Math.max(2, Math.min(INT_W - art.r.w - 2, x - art.tail.x));
    if (slotIdx === 2 && chars < 30) bx = Math.max(bx, 100); // right seat clears the left one
    const lift = slotIdx === 1 ? 26 : 0; // the centre seat takes the upper tier
    const by = (ranked ? HEAD_TIP - 2 - art.r.h : HEAD_TIP - art.tail.y) - lift;
    r.blit(art.r, bx, by, { alpha: v.alpha });
    if (ranked && s.slots && v.alpha > 0.9) {
      const place = s.slots.to.indexOf(w);
      if (place >= 0 && place < 3) {
        r.rect(bx - 1, by - 8, 7, 7, 'ink');
        r.frame(bx - 1, by - 8, 7, 7, 'glow');
        drawText(r, bx + 1, by - 7, String(place + 1), 'glow-core');
      }
    }
  }
}

function paintVerdict(r: Raster, s: RoundTableState, o: PaintOpts): void {
  const v = s.verdict;
  if (!v) return;
  const age = o.t - v.since;
  if (age < 0 || age > 8000 + 120) return;
  const enter = o.calm ? 1 : easeOut(Math.min(1, age / 240));
  const exit = age > 8000 ? 1 - (age - 8000) / 120 : 1;
  const art = bubble(v.text, 'announce', 24, 4, 0.7);
  const x = Math.max(2, Math.min(INT_W - art.r.w - 2, CHAIR.x - art.tail.x));
  r.blit(art.r, x, CHAIR.feet - 34 - art.tail.y, { alpha: Math.max(0, Math.min(enter, exit)) });
}
