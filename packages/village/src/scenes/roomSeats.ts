import type { TranscriptEntry } from './roomTypes';
import type { Raster } from './pixel/raster';
import { drawText, textWidth } from './pixel/font';

/**
 * Who stands or sits where inside each room interior (224x128 art px, feet position), so a click, a
 * Tab or an Enter on a character can open the Agent Inspector. Pure data plus a few helpers; the
 * Phaser binding lives in module.ts and the popup in packages/web/src/overlays/inspector.
 */
export interface RoomSeat {
  /** Inspector agent id the seat belongs to (the council id, the expert id). */
  agent: string;
  /** Speaker key as transcript entries carry it (member name, 'chair', expert id). */
  who: string;
  label: string;
  /** Feet position in interior px. */
  x: number;
  y: number;
}

interface SeatState {
  seats?: Readonly<Record<string, number>>;
  debaters?: readonly string[];
}

const nice = (s: string): string =>
  s
    .replace(/^(expert|council):/, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (w.length === 1 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');

/** Plain name for a speaker key: 'solver-a' -> 'Solver A', 'chair' -> 'Chair'. */
export const seatLabel = (who: string): string => nice(who) || 'Someone';

const memberAt = (st: SeatState, seat: number, fallback: readonly string[]): string => {
  for (const [m, i] of Object.entries(st.seats ?? {})) if (i === seat) return m;
  return fallback[seat] ?? `member-${seat + 1}`;
};

const COUNCIL_FEET = [
  { x: 50, y: 103 },
  { x: 112, y: 121 },
  { x: 174, y: 103 },
] as const;
const TABLE_FEET = [
  { x: 36, y: 111 },
  { x: 90, y: 111 },
  { x: 144, y: 111 },
] as const;
const LECTERNS = [
  { x: 50, y: 112 },
  { x: 174, y: 112 },
] as const;

/** Single-figure rooms: the expert (or the prop it speaks through) and where it stands. */
const SOLO: Record<string, { x: number; y: number }> = {
  'feynman-porch': { x: 112, y: 121 },
  'panic-booth': { x: 112, y: 119 },
  'exam-oracle': { x: 112, y: 90 },
  'oral-exam-hut': { x: 112, y: 104 },
  'rubric-courthouse': { x: 112, y: 104 },
  'devils-ta': { x: 130, y: 90 },
};

/**
 * The characters in `slot`, left to right. `agent` is the room's agent id (council id or expert id);
 * `state` is the scene state (council seats, debaters). Chapter houses have the expert at the desk.
 */
export function roomSeats(slot: string, agent: string, state: unknown): RoomSeat[] {
  const st = (state ?? {}) as SeatState;
  const mk = (who: string, p: { x: number; y: number }, label = seatLabel(who)): RoomSeat => ({
    agent,
    who,
    label,
    x: p.x,
    y: p.y,
  });
  let out: RoomSeat[];
  if (slot === 'council-hall') {
    const names = ['solver-a', 'solver-b', 'solver-c'];
    out = [
      ...COUNCIL_FEET.map((p, i) => mk(memberAt(st, i, names), p)),
      mk('chair', { x: 112, y: 89 }, 'Chair'),
    ];
  } else if (slot === 'round-table') {
    const names = ['chill', 'grind', 'advisor'];
    out = [
      ...TABLE_FEET.map((p, i) => mk(memberAt(st, i, names), p)),
      mk('chair', { x: 196, y: 113 }, 'Chair'),
    ];
  } else if (slot === 'debate-stage') {
    const names = ['chill', 'grind'];
    out = LECTERNS.map((p, i) => mk(st.debaters?.[i] ?? names[i]!, p));
  } else if (slot.startsWith('chapter-')) {
    out = [mk(agent, { x: 111, y: 118 }, 'Chapter expert')];
  } else {
    const p = SOLO[slot];
    out = p ? [mk(agent, p, seatLabel(agent))] : [];
  }
  return out.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Hit box of a seat in interior px: roughly the figure (24 wide, 36 tall, feet at the bottom). */
export const SEAT_BOX = { w: 26, h: 38 } as const;

/** True when a transcript line is one the seat's character said (the chair also says the verdict). */
export function saidBy(who: string, e: Pick<TranscriptEntry, 'who' | 'kind'>): boolean {
  if (e.who === who) return true;
  if (who === 'chair' && e.kind === 'verdict') return true;
  // an expert says its captions and the quiz questions it asks
  if (who.startsWith('expert') && (e.kind === 'question' || e.kind === 'caption')) return true;
  return false;
}

/** Name tag over a character: small, filled, no outline. Painted into the interior raster. */
export function paintSeatTag(r: Raster, seat: RoomSeat, focused: boolean): void {
  const w = textWidth(seat.label) + 6;
  const x = Math.max(1, Math.min(r.w - w - 1, Math.round(seat.x - w / 2)));
  const y = Math.max(1, seat.y - SEAT_BOX.h - 10);
  r.rect(x, y, w, 9, 'ink');
  drawText(r, x + 3, y + 2, seat.label, focused ? 'glow-core' : 'cloud-hi');
}

/** Ring under the feet of the selected or keyboard-focused character. */
export function paintSeatRing(r: Raster, seat: RoomSeat): void {
  r.ring(seat.x, seat.y + 1, 13, 3, 'violet', 0.9);
}
