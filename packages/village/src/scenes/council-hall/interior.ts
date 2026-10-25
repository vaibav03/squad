import { Raster } from '../pixel/raster';
import type { PaletteName } from '../pixel/palette';
import { drawText, drawTextCentered, textWidth } from '../pixel/font';
import { hashString } from '../pixel/rng';
import type { PaintOpts } from '../contract';
import { easeInOut, easeOut, progress } from '../curves';
import { bubble } from '../art/bubble';
import { npc, type NpcSpec } from '../art/npc';
import { frameAt, lanternFrame, triangle, visibleBubbles } from '../model/base';
import { CHAIR_SEAT, isChair, seatOf, type CouncilHallState } from './state';

export const INT_W = 256;
export const INT_H = 136;
/** Where the player stands when the interior opens (centre of the floor, in front of the table). */
export const ENTRY = { x: 128, y: 130 };

/** Seat centres (x) and the feet line (y) of the three members and the chair on the dais. */
export const SEAT_X = [76, 128, 180] as const;
export const SEAT_Y = 96;
export const DAIS_Y = 44;
const TABLE = { cx: 128, cy: 101, rx: 66, ry: 12 };

const MEMBER_LOOKS: Record<string, NpcSpec> = {
  'solver-a': { hair: 'wood-dark', shirt: 'violet', accessory: 'glasses' },
  'solver-b': { hair: 'glow', shirt: 'leaf-lit', accessory: 'cap' },
  'solver-c': { hair: 'roof-wine', shirt: 'wall-shade', accessory: 'hood' },
  chill: { hair: 'wood', shirt: 'ok', accessory: 'cap' },
  grind: { hair: 'ink', shirt: 'alert', accessory: 'visor' },
  advisor: { hair: 'wall-lit', shirt: 'wall-shade', accessory: 'glasses', trim: 'glow' },
};
const SPARE: NpcSpec[] = [
  { hair: 'wood-dark', shirt: 'leaf-lit', accessory: 'glasses' },
  { hair: 'glow', shirt: 'violet' },
  { hair: 'roof-wine', shirt: 'ok', accessory: 'cap' },
];
const CHAIR_LOOK: NpcSpec = {
  hair: 'wall-lit',
  shirt: 'roof-wine',
  trim: 'glow',
  accessory: 'beard',
  robe: true,
};

export function lookOf(member: string): NpcSpec {
  return MEMBER_LOOKS[member] ?? SPARE[hashString(member) % SPARE.length]!;
}

/** Short plate text for the table front: 'solver-a' -> 'SOLVER A'. */
export function plateOf(member: string): string {
  return member.replace(/[-_]/g, ' ').slice(0, 9).toUpperCase();
}

const cache = new Map<string, Raster>();

function brickWall(r: Raster, x: number, y: number, w: number, h: number): void {
  r.rect(x, y, w, h, 'wall-shade');
  for (let j = 0; j < h; j += 6) {
    r.hline(x, y + j, w, 'hill-mid');
    const off = (j / 6) % 2 === 0 ? 0 : 6;
    for (let i = off; i < w; i += 12) r.vline(x + i, y + j + 1, 5, 'hill-mid');
  }
  r.dither(x, y, w, 10, 'wall-mid', 0); // top edge catches the chandelier light
}

function pillar(r: Raster, x: number, top: number, bottom: number): void {
  r.rect(x - 3, top, 7, bottom - top, 'wall-lit');
  r.vline(x - 3, top, bottom - top, 'wall-mid');
  r.vline(x + 3, top, bottom - top, 'wall-shade');
  r.vline(x + 2, top, bottom - top, 'wall-mid');
  r.rect(x - 5, top, 11, 3, 'wall-lit');
  r.hline(x - 5, top + 2, 11, 'wall-shade');
  r.rect(x - 5, bottom - 3, 11, 3, 'wall-lit');
  r.hline(x - 5, bottom - 1, 11, 'wall-shade');
}

function archAlcove(r: Raster, cx: number, top: number, w: number, h: number): void {
  const x = cx - Math.floor(w / 2);
  r.rect(x, top + 4, w, h - 4, 'sky-deep');
  r.rect(x + 2, top + 2, w - 4, 2, 'sky-deep');
  r.rect(x + 4, top, w - 8, 2, 'sky-deep');
  // stars through the glass
  for (let k = 0; k < 5; k++) {
    r.px(x + 2 + ((k * 7 + hashString(`${cx}${k}`)) % (w - 4)), top + 6 + ((k * 5) % (h - 14)), k % 2 ? 'cloud-hi' : 'moon');
  }
  r.vline(cx, top + 2, h - 2, 'wall-shade'); // mullion
  r.hline(x, top + Math.floor(h / 2), w, 'wall-shade');
  // stone surround
  r.vline(x - 1, top + 4, h - 4, 'wall-lit');
  r.vline(x + w, top + 4, h - 4, 'wall-lit');
  r.hline(x, top + h, w, 'wall-lit');
  r.hline(x - 1, top + h + 1, w + 2, 'wall-mid');
  r.hline(x + 1, top + 1, w - 2, 'wall-lit');
}

function banner(r: Raster, x: number, y: number, tone: PaletteName): void {
  r.rect(x, y, 12, 28, tone);
  r.poly(
    [
      [x, y + 28],
      [x + 12, y + 28],
      [x + 6, y + 34],
    ],
    tone,
  );
  r.vline(x + 1, y, 28, tone === 'violet' ? 'cloud-lo' : 'alert');
  r.ring(x + 6, y + 13, 3, 3, 'glow');
  r.px(x + 6, y + 13, 'glow-core');
  r.hline(x - 2, y - 2, 16, 'wood-dark');
  r.px(x - 2, y - 3, 'glow');
  r.px(x + 13, y - 3, 'glow');
}

function throne(r: Raster): void {
  const cx = 128;
  // alcove behind the chair
  r.rect(cx - 26, 6, 52, 44, 'sky-deep');
  r.rect(cx - 22, 2, 44, 4, 'sky-deep');
  r.rect(cx - 14, 0, 28, 2, 'sky-deep');
  r.dither(cx - 26, 30, 52, 20, 'wall-shade', 0);
  r.vline(cx - 27, 8, 42, 'wall-lit');
  r.vline(cx + 26, 8, 42, 'wall-lit');
  // curtain swags either side
  r.rect(cx - 26, 6, 8, 44, 'roof-shade');
  r.rect(cx + 18, 6, 8, 44, 'roof-shade');
  for (let k = 0; k < 44; k += 5) {
    r.vline(cx - 24 + (k % 10 === 0 ? 0 : 3), 6 + k, 5, 'roof-wine');
    r.vline(cx + 20 + (k % 10 === 0 ? 3 : 0), 6 + k, 5, 'roof-wine');
  }
  // high-backed throne
  r.rect(cx - 9, 16, 18, 30, 'wood');
  r.rect(cx - 7, 18, 14, 24, 'roof-wine');
  r.rect(cx - 7, 18, 14, 3, 'roof-shade');
  r.vline(cx - 9, 16, 30, 'wood-lit');
  r.px(cx - 9, 15, 'glow');
  r.px(cx + 8, 15, 'glow');
  r.rect(cx - 3, 12, 6, 4, 'wood');
  r.px(cx, 11, 'glow');
  // dais: three steps
  r.rect(cx - 36, DAIS_Y + 5, 72, 3, 'wall-mid');
  r.hline(cx - 36, DAIS_Y + 5, 72, 'wall-lit');
  r.rect(cx - 30, DAIS_Y + 1, 60, 4, 'wood-lit');
  r.hline(cx - 30, DAIS_Y + 1, 60, 'wood-lit');
  r.hline(cx - 30, DAIS_Y + 4, 60, 'wood');
  r.rect(cx - 42, DAIS_Y + 8, 84, 3, 'wall-shade');
  r.hline(cx - 42, DAIS_Y + 8, 84, 'wall-mid');
}

function floor(r: Raster): void {
  const y0 = 80;
  r.rect(0, y0, INT_W, INT_H - y0, 'wood-dark');
  // perspective planks: lines converge on the vanishing point (128, 40)
  for (let k = -16; k <= 16; k++) {
    const xb = 128 + k * 16;
    r.line(128 + (xb - 128) * 0.2, y0, xb, INT_H, 'wood');
  }
  for (const y of [84, 90, 97, 105, 114, 124]) r.hline(0, y, INT_W, 'wood');
  r.dither(0, y0, INT_W, 6, 'ink', 0);
  // skirting
  r.rect(0, y0, INT_W, 3, 'wall-shade');
  r.hline(0, y0, INT_W, 'wall-lit');
  r.hline(0, y0 + 2, INT_W, 'ink');
  // rug under the table
  r.ellipse(128, 106, 92, 20, 'roof-shade');
  r.ellipse(128, 106, 88, 18, 'roof-wine');
  r.ellipse(128, 106, 80, 15, 'roof-shade');
  r.dither(60, 100, 136, 10, 'roof-wine', 0);
}

function sideWalls(r: Raster): void {
  r.rect(0, 0, 10, 82, 'wall-shade');
  r.rect(INT_W - 10, 0, 10, 82, 'wall-shade');
  r.vline(10, 0, 82, 'ink');
  r.vline(INT_W - 11, 0, 82, 'ink');
  r.dither(0, 0, 10, 82, 'hill-mid', 0);
  r.dither(INT_W - 10, 0, 10, 82, 'hill-mid', 1);
}

function background(): Raster {
  const hit = cache.get('bg');
  if (hit) return hit;
  const r = new Raster(INT_W, INT_H);
  brickWall(r, 0, 0, INT_W, 82);
  archAlcove(r, 40, 12, 24, 52);
  archAlcove(r, 84, 12, 24, 52);
  archAlcove(r, 172, 12, 24, 52);
  archAlcove(r, 216, 12, 24, 52);
  pillar(r, 62, 8, 82);
  pillar(r, 194, 8, 82);
  pillar(r, 20, 8, 82);
  pillar(r, 236, 8, 82);
  throne(r);
  banner(r, 100 - 3, 12, 'violet');
  banner(r, 156 - 3, 12, 'violet');
  floor(r);
  sideWalls(r);
  cache.set('bg', r);
  return r;
}

/** The glowing circle inscription on the floor: ring, ticks, inner ring (the arena mood). */
function floorRing(r: Raster, pulse: number): void {
  const cx = 128;
  const cy = 108;
  const col: PaletteName = 'violet';
  const a = 0.55 + 0.35 * pulse;
  r.ring(cx, cy, 100, 22, col, a);
  r.ring(cx, cy, 98, 21, 'cloud-hi', 0.18 * a);
  r.ring(cx, cy, 78, 16, col, a * 0.8);
  for (let k = 0; k < 24; k++) {
    const th = (k / 24) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(th) * 100);
    const y = Math.round(cy + Math.sin(th) * 22);
    const x2 = Math.round(cx + Math.cos(th) * 94);
    const y2 = Math.round(cy + Math.sin(th) * 20.6);
    r.line(x, y, x2, y2, k % 2 ? 'cloud-hi' : col);
  }
  r.glow(cx, cy, 70, col, 0.1 + 0.08 * pulse, 3);
}

function torch(r: Raster, x: number, y: number, frame: number): void {
  r.rect(x - 1, y + 4, 3, 8, 'wood-dark');
  r.rect(x - 3, y + 2, 7, 3, 'wood');
  r.rect(x - 2, y - 3 + frame, 5, 6 - frame, 'ember');
  r.rect(x - 1, y - 5 + frame, 3, 5, 'glow');
  r.px(x, y - 6 + frame, 'glow-core');
  r.px(x, y - 2, 'glow-core');
  r.glow(x, y, 14, 'glow', 0.35, 3);
}

function chandelier(r: Raster, o: PaintOpts, lit: boolean): void {
  const cx = 128;
  r.vline(cx, 0, 4, 'ink');
  r.hline(cx - 14, 5, 29, 'wood-dark');
  r.hline(cx - 12, 6, 25, 'wood');
  for (const dx of [-12, -6, 0, 6, 12]) {
    r.rect(cx + dx - 1, 2, 3, 3, 'wall-lit');
    if (lit) {
      const f = o.calm ? 0 : (Math.floor(o.t / 500) + dx) % 2 === 0 ? 0 : 1;
      r.px(cx + dx, 0 + f, 'glow-core');
      r.px(cx + dx, 1, 'glow');
    }
  }
  if (lit) r.glow(cx, 3, 20, 'glow', 0.28, 3);
}

function lectern(r: Raster): void {
  const cx = 128;
  r.rect(cx - 12, DAIS_Y - 2, 24, 4, 'wood');
  r.hline(cx - 12, DAIS_Y - 2, 24, 'wood-lit');
  r.rect(cx - 10, DAIS_Y + 1, 20, 1, 'wood-dark');
}

function table(r: Raster, s: CouncilHallState, o: PaintOpts, plates: { member: string; x: number }[]): void {
  const { cx, cy, rx, ry } = TABLE;
  // legs
  r.rect(cx - 52, cy + 4, 6, 18, 'wood-dark');
  r.rect(cx + 46, cy + 4, 6, 18, 'wood-dark');
  r.rect(cx - 6, cy + 8, 12, 16, 'wood-dark');
  // apron (front face) then top
  r.rect(cx - rx, cy, rx * 2 + 1, 9, 'wood-dark');
  r.ellipse(cx, cy + 8, rx, ry - 2, 'wood-dark');
  r.ellipse(cx, cy, rx, ry, 'wood');
  r.ellipse(cx, cy - 1, rx - 3, ry - 3, 'wood-lit');
  r.ellipse(cx, cy - 1, rx - 8, ry - 6, 'wood');
  r.dither(cx - rx + 10, cy - 6, 40, 4, 'wood-lit', 0);
  // inlaid ring echoing the floor
  r.ring(cx, cy - 1, rx - 10, ry - 5, 'glow', 0.7);
  // papers and an inkwell for set dressing
  r.rect(cx - 40, cy - 4, 8, 5, 'wall-lit');
  r.px(cx - 38, cy - 3, 'ink');
  r.rect(cx + 32, cy - 3, 7, 4, 'wall-lit');
  r.rect(cx + 24, cy - 6, 2, 3, 'ink');
  r.px(cx + 24, cy - 7, 'wall-lit');
  // brass nameplates on the apron
  for (const p of plates) {
    const w = textWidth(plateOf(p.member)) + 4;
    const dissent = s.verdict?.dissenter === p.member;
    r.rect(p.x - Math.floor(w / 2), cy + 3, w, 7, 'ink');
    r.frame(p.x - Math.floor(w / 2), cy + 3, w, 7, dissent ? 'alert' : 'wood-lit');
    drawTextCentered(r, p.x, cy + 4, plateOf(p.member), dissent ? 'alert' : 'glow-core');
  }
  void o;
}

function lanternInterior(r: Raster, s: CouncilHallState, o: PaintOpts): void {
  const f = lanternFrame(s, o);
  const x = 229;
  const y = 22;
  r.rect(x - 1, 0, 2, y - 2, 'ink'); // chain
  r.rect(x - 6, y - 3, 12, 3, 'wood-dark');
  r.rect(x - 7, y, 14, 14, 'ink');
  const lit = s.lantern !== 'off';
  const core: PaletteName = !lit
    ? 'wall-shade'
    : s.lantern === 'flicker'
      ? f === 2
        ? 'alert'
        : f === 1
          ? 'ember'
          : 'roof-wine'
      : 'glow';
  r.rect(x - 5, y + 2, 10, 10, core);
  if (lit && f > 0) r.rect(x - 3, y + 4, 6, 6, s.lantern === 'flicker' ? 'ember' : 'glow-core');
  r.vline(x, y + 1, 12, 'wood-dark');
  r.hline(x - 6, y + 7, 12, 'wood-dark');
  r.rect(x - 6, y + 14, 12, 2, 'wood-dark');
  if (lit) {
    const col: PaletteName = s.lantern === 'flicker' ? 'alert' : 'glow';
    r.glow(x, y + 7, 20, col, f === 0 ? 0.15 : 0.4, 3);
  }
  if (s.lantern === 'flicker') {
    // plaque: the dissent lantern's meaning, in plain words
    r.rect(x - 24, y + 20, 48, 15, 'ink');
    r.frame(x - 24, y + 20, 48, 15, 'wood-lit');
    drawTextCentered(r, x, y + 23, 'UNCERTAIN,', 'glow-core');
    drawTextCentered(r, x, y + 29, 'ASK YOUR TA', 'glow');
  }
}

interface Pos {
  x: number;
  y: number;
}

function seatPos(seat: number): Pos {
  return { x: SEAT_X[seat] ?? SEAT_X[1], y: SEAT_Y };
}

/** Interior cutaway (256x136): Council Hall with 3 members at the round table and the chair on the dais. */
export function paintInterior(s: CouncilHallState, o: PaintOpts): Raster {
  const r = background().clone();
  const open = s.access === 'open';
  const active = open && (s.bubbles.length > 0 || s.verdict !== null || s.rank !== null);
  const pulse = o.calm ? 0.5 : triangle(o.t, 2000);
  floorRing(r, pulse);
  chandelier(r, o, open);
  torch(r, 10, 50, o.calm ? 0 : Math.floor(o.t / 300) % 2);
  torch(r, INT_W - 10, 50, o.calm ? 0 : Math.floor(o.t / 300 + 1) % 2);
  lanternInterior(r, s, o);

  const breathe = frameAt(o.t, 2, o.calm);
  const seatedMembers = Object.entries(s.seats).map(([m, seat]) => ({ member: m, seat }));
  const bubbles = visibleBubbles(s, o);
  const thinking = new Set(bubbles.filter((b) => b.b.style === 'thought').map((b) => b.b.who));
  const speakerWho = s.speaker && o.t - s.speaker.since < 1500 ? s.speaker.who : null;

  // chair: throne, then the chairman (rises on verdict; 240 ms ease-out, instant in calm)
  const standT = s.verdict ? (o.calm ? 1 : easeOut(progress(o.t, s.verdict.since, 240))) : 0;
  const standing = s.verdict !== null && o.t - s.verdict.since < 9000;
  const rise = standing ? Math.round(3 * standT) : 0;
  const chairPose = standing ? 'point' : 'sit';
  const chair = npc(CHAIR_LOOK, chairPose, chairPose === 'point' ? frameAt(o.t, 8, o.calm) : 0);
  r.blit(chair, SEAT_X[1] - 6, DAIS_Y - 17 + 3 - rise + (standing ? 0 : breathe));
  lectern(r);
  // chair nameplate
  drawTextCentered(r, 128, DAIS_Y + 6, 'CHAIR', 'ink');

  // members: draw back to front (all on one row); table covers their laps
  const plates: { member: string; x: number }[] = [];
  const present = open || seatedMembers.length > 0;
  for (let seat = 0; seat < 3; seat++) {
    const who = seatedMembers.find((m) => m.seat === seat)?.member;
    const member = who ?? ['solver-a', 'solver-b', 'solver-c'][seat]!;
    const pos = seatPos(seat);
    // empty seats still show their member: a council is always present in the hall
    const talking = speakerWho === member;
    const pose = talking ? 'talk' : thinking.has(member) ? 'think' : 'sit';
    const sprite = npc(lookOf(member), pose, talking ? frameAt(o.t, 8, o.calm) : 0);
    if (present) r.blit(sprite, pos.x - 6, pos.y - 17 + (pose === 'sit' ? breathe : 0));
    plates.push({ member, x: pos.x });
  }
  table(r, s, o, plates);

  paintBubbles(r, s, o, bubbles);
  if (s.verdict) paintVerdict(r, s, o);
  void active;
  void isChair;
  void seatOf;
  void CHAIR_SEAT;
  void easeInOut;
  return r;
}

function drawBubbleAt(r: Raster, art: ReturnType<typeof bubble>, tip: Pos, alpha: number): void {
  r.blit(art.r, tip.x - art.tail.x, tip.y - art.tail.y, { alpha });
}

function paintBubbles(
  r: Raster,
  s: CouncilHallState,
  o: PaintOpts,
  bubbles: ReturnType<typeof visibleBubbles>,
): void {
  const headTop = SEAT_Y - 17 - 2;
  for (const v of bubbles) {
    const seat = isChair(v.b.who) ? 1 : (s.seats[v.b.who] ?? seatOf(s.seats, v.b.who));
    const ranked = s.slots !== null && v.b.style !== 'announce';
    let x: number = SEAT_X[seat] ?? 128;
    if (ranked && s.slots) {
      const from = s.slots.from.indexOf(v.b.who);
      const to = s.slots.to.indexOf(v.b.who);
      const fx = SEAT_X[from < 0 ? seat : from] ?? x;
      const tx = SEAT_X[to < 0 ? seat : to] ?? x;
      const k = o.calm ? 1 : easeInOut(progress(o.t, s.slots.since, 320));
      x = Math.round(fx + (tx - fx) * k);
    }
    const style = ranked && v.b.style === 'thought' ? 'speech' : v.b.style;
    const art = bubble(v.b.text, style, 20, 3, ranked ? null : 0.5);
    if (ranked) {
      // bubbles hover in the rank row above the table; numerals show position, never a score
      drawBubbleAt(r, art, { x, y: headTop - 3 + art.r.h - art.tail.y }, o.calm ? v.alpha : v.alpha);
    } else {
      drawBubbleAt(r, art, { x, y: headTop }, v.alpha);
    }
  }
  if (s.slots) {
    s.slots.to.slice(0, 3).forEach((m, i) => {
      if (!s.bubbles.some((b) => b.who === m)) return;
      const x = SEAT_X[i] ?? 128;
      const label = String(i + 1);
      r.rect(x - 4, headTop - 38, 9, 7, 'ink');
      r.frame(x - 4, headTop - 38, 9, 7, 'glow');
      drawTextCentered(r, x, headTop - 37, label, 'glow-core');
    });
  }
}

function paintVerdict(r: Raster, s: CouncilHallState, o: PaintOpts): void {
  const v = s.verdict;
  if (!v) return;
  const age = o.t - v.since;
  if (age < 0 || age > 8000 + 120) return;
  const enter = o.calm ? 1 : easeOut(Math.min(1, age / 240));
  const exit = age > 8000 ? 1 - (age - 8000) / 120 : 1;
  const art = bubble(v.text, 'announce', 26, 3, 0.1);
  const headTop = DAIS_Y - 17 + 3 - 3 - 2;
  r.blit(art.r, 128 - art.tail.x, headTop - art.tail.y, { alpha: Math.max(0, Math.min(enter, exit)) });
}

void drawText;
