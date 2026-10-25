import { Raster } from '../pixel/raster';
import { DIM } from '../pixel/palette';
import { drawText, textWidth } from '../pixel/font';
import type { PaintOpts } from '../contract';
import { put, type AssetInfo } from '../assets';
import { bubble } from '../art/bubble';
import { easeInOut, easeOut, progress } from '../curves';
import { frameAt, lanternFrame, triangle, visibleBubbles } from '../model/base';
import { isChair, seatOf, type CouncilHallState } from './state';

export const INT_W = 224;
export const INT_H = 128;
/** Where the player stands when the interior opens (floor, in front of the table). */
export const ENTRY = { x: 112, y: 120 };

/** Seats from the composed interior's anchors: left, front, right (members) and the chair behind the table. */
export const SEATS = [
  { x: 50, y: 103, flip: false },
  { x: 112, y: 121, flip: false },
  { x: 174, y: 103, flip: true },
] as const;
export const CHAIR_AT = { x: 112, y: 89 };
const ROW_X = [50, 112, 174] as const; // bubble row slots (rank positions)
const ROW_TIP = 30; // bubble row: tail tip y

/** Cast persona per member (03: solvers and planners). Unknown members borrow by seat. */
const PERSONA: Record<string, string> = {
  'solver-a': 'council-chill',
  'solver-b': 'council-hard',
  'solver-c': 'council-balance',
  chill: 'council-chill',
  grind: 'council-hard',
  advisor: 'council-balance',
};
const BY_SEAT = ['council-chill', 'council-hard', 'council-balance'];

export function personaOf(member: string, seat: number): string {
  return PERSONA[member] ?? BY_SEAT[seat % 3]!;
}

const dim = new WeakMap<Raster, Raster>();
function dimmed(r: Raster): Raster {
  let d = dim.get(r);
  if (!d) {
    d = r.clone().remap(DIM);
    dim.set(r, d);
  }
  return d;
}

function cast(r: Raster, a: AssetInfo, x: number, y: number, flip: boolean): void {
  put(r, a, x, y, { flipX: flip });
}

/** Interior (224x128): composed council chamber, members at the round table, the chair behind it. */
export function paintInterior(s: CouncilHallState, o: PaintOpts): Raster {
  const A = o.assets;
  const r = new Raster(INT_W, INT_H);
  const room = A.image('interior.council');
  r.blit(s.access === 'open' ? room.r : dimmed(room.r), 0, 0);

  const breathe = frameAt(o.t, 2, o.calm);
  const bubbles = visibleBubbles(s, o);
  const thinking = new Set(bubbles.filter((b) => b.b.style === 'thought').map((b) => b.b.who));
  const speakerWho = s.speaker && o.t - s.speaker.since < 1500 ? s.speaker.who : null;
  const standing = s.verdict !== null && o.t - s.verdict.since < 9000;

  // floor pulse: a faint violet ring echoing the inscription, 2 s loop (steady in calm)
  if (s.access === 'open') {
    const p = o.calm ? 0.5 : triangle(o.t, 2000);
    r.ring(112, 110, 70, 12, 'violet', 0.18 + 0.2 * p);
  }

  // dissent lantern from the composed lantern slot [112,13]
  if (s.lantern !== 'off') {
    const f = lanternFrame(s, o);
    put(r, { ...A.sheet('ui.lantern-dissent', f), ax: 5, ay: 0 }, 112, 13);
    r.glow(112, 24, 14, s.lantern === 'flicker' ? 'alert' : 'glow', f === 0 ? 0.12 : 0.38, 3);
  }
  if (s.lantern === 'flicker') {
    const t = 'UNCERTAIN, ASK YOUR TA';
    const w = textWidth(t) + 6;
    r.rect(INT_W - w - 4, 119, w, 8, 'ink');
    r.frame(INT_W - w - 4, 119, w, 8, 'wood-lit');
    drawText(r, INT_W - w - 1, 121, t, 'glow-core');
  }

  // chair (behind the table): sits, stands to announce (rise 240 ms ease-out)
  const rise = standing
    ? Math.round(5 * (o.calm ? 1 : easeOut(progress(o.t, s.verdict!.since, 240))))
    : 0;
  const chairAnim = standing ? 'talk' : 'sit';
  const chairN = standing ? frameAt(o.t, 8, o.calm) : breathe;
  cast(r, A.frame('chairman', chairAnim, chairN), CHAIR_AT.x, CHAIR_AT.y - rise, false);

  // members: draw in z order (back first: left/right at y 103, then the front seat)
  const bySeat = new Map<number, string>();
  for (const [m, seat] of Object.entries(s.seats)) bySeat.set(seat, m);
  for (const seat of [0, 2, 1]) {
    const pos = SEATS[seat]!;
    const member = bySeat.get(seat) ?? '';
    const talking = member !== '' && speakerWho === member;
    const anim = talking ? 'talk' : 'sit';
    const n = talking ? frameAt(o.t, 8, o.calm) : thinking.has(member) ? 0 : breathe;
    const persona = personaOf(member, seat);
    const dissenting = member !== '' && s.verdict?.dissenter === member;
    cast(r, A.frame(persona, anim, n), pos.x, pos.y, pos.flip);
    if (dissenting) put(r, A.image('ui.marker-alert'), pos.x, pos.y - 30);
  }

  paintBubbles(r, s, o, bubbles);
  paintVerdict(r, s, o);
  return r;
}

function tip(art: ReturnType<typeof bubble>, x: number, y: number) {
  return { x: x - art.tail.x, y: y - art.tail.y };
}

function paintBubbles(
  r: Raster,
  s: CouncilHallState,
  o: PaintOpts,
  bubbles: ReturnType<typeof visibleBubbles>,
): void {
  for (const v of bubbles) {
    const seat = isChair(v.b.who) ? 1 : (s.seats[v.b.who] ?? seatOf(s.seats, v.b.who));
    const ranked = s.slots !== null && v.b.style !== 'announce';
    let x: number = ROW_X[seat] ?? 112;
    if (ranked && s.slots) {
      const from = s.slots.from.indexOf(v.b.who);
      const to = s.slots.to.indexOf(v.b.who);
      const fx = ROW_X[from < 0 ? seat : from] ?? x;
      const tx = ROW_X[to < 0 ? seat : to] ?? x;
      x = Math.round(fx + (tx - fx) * (o.calm ? 1 : easeInOut(progress(o.t, s.slots.since, 320))));
    }
    const style = ranked && v.b.style === 'thought' ? 'speech' : v.b.style;
    const art = bubble(v.b.text, style, 12, 3, ranked ? null : 0.5);
    const pos = tip(art, x, ROW_TIP + (ranked ? art.r.h - art.tail.y : 0));
    r.blit(art.r, pos.x, pos.y, { alpha: v.alpha });
    if (!ranked) {
      // thought trail: two dots from the bubble down to the member's head
      const head = SEATS[seat]!;
      const hx = head.x;
      const hy = head.y - 31;
      for (let k = 1; k <= 3; k++) {
        const px = Math.round(x + ((hx - x) * k) / 4);
        const py = Math.round(ROW_TIP + 2 + ((hy - ROW_TIP) * k) / 4);
        r.px(px, py, 'cloud-hi', v.alpha > 0.5 ? 1 : 0);
        r.px(px, py + 1, 'ink', v.alpha > 0.5 ? 1 : 0);
      }
    }
    const place = s.slots ? s.slots.to.indexOf(v.b.who) : -1;
    if (ranked && place >= 0 && place < 3 && v.alpha > 0.9) {
      // rank tab on the bubble's corner: position only, never a score
      r.rect(pos.x - 2, pos.y - 3, 7, 7, 'ink');
      r.frame(pos.x - 2, pos.y - 3, 7, 7, 'glow');
      drawText(r, pos.x, pos.y - 2, String(place + 1), 'glow-core');
    }
  }
}

function paintVerdict(r: Raster, s: CouncilHallState, o: PaintOpts): void {
  const v = s.verdict;
  if (!v) return;
  const age = o.t - v.since;
  if (age < 0 || age > 8000 + 120) return;
  const enter = o.calm ? 1 : easeOut(Math.min(1, age / 240));
  const exit = age > 8000 ? 1 - (age - 8000) / 120 : 1;
  const art = bubble(v.text, 'announce', 24, 3, 0.5);
  const headTop = CHAIR_AT.y - 31 - 3;
  r.blit(art.r, 112 - art.tail.x, headTop - art.tail.y, {
    alpha: Math.max(0, Math.min(enter, exit)),
  });
}
