import { a2aPartyName } from '../adapter/labels';
import { easeInOut, easeOut } from '../scenes/curves';
import { KIND_LABEL } from './model';
import type { BoardLink } from './store';
import type { A2aKind } from './types';

/**
 * Message arrows (docs/specs/08-village-motion.md row 22). Pure planning: which arrows are on screen at `now`,
 * how opaque, and where the 3 px packet is. Drawing lives in module.ts (world) and scenes/module.ts (rooms).
 * Never score-like: every arrow has the same width and the one violet link colour; direction is the arrowhead.
 */
export const ARROW_FADE_IN_MS = 160;
export const ARROW_PACKET_MS = 320;
/** Time after the packet lands before the arc starts to fade. */
export const ARROW_HOLD_MS = 600;
export const ARROW_FADE_OUT_MS = 600;
/** Arrow strokes are all this wide (px). */
export const ARROW_WIDTH = 1;
export const ARROW_PACKET_SIZE = 3;
export const ARROW_MAX = 3;
/** Calm mode: steady alpha while the link is active. */
export const ARROW_CALM_ALPHA = 0.4;
const ARROW_ALPHA = 0.7;
/** At most 2 packets start per rolling second, so the packet frequency stays under 3 Hz. */
const PACKET_WINDOW_MS = 1000;
const PACKET_MAX_PER_WINDOW = 2;

/** Total life of an arrow from the message arrival. */
export const ARROW_LIFE_MS = ARROW_FADE_IN_MS + ARROW_PACKET_MS + ARROW_HOLD_MS + ARROW_FADE_OUT_MS;
/** How far back the store must be asked for links (ms). */
export const ARROW_WINDOW_MS = ARROW_LIFE_MS;

export interface Pt {
  x: number;
  y: number;
}

export interface Arrow {
  key: string;
  from: string;
  to: string;
  kind: A2aKind;
  /** The kind word ('Asks'). */
  label: string;
  /** Names of both ends, for announcements and tooltips. */
  title: string;
  alpha: number;
  /** 0..1 along the arc, or null when there is no packet (calm, not started, landed, or rate-capped). */
  packetT: number | null;
  static: boolean;
}

export interface PlanOptions {
  calm: boolean;
  now: number;
  max?: number;
}

export type ArrowLink = Pick<BoardLink, 'from' | 'to' | 'kind' | 'at' | 'messageId'>;

export function planArrows(
  links: readonly ArrowLink[],
  positions: ReadonlyMap<string, Pt> | Readonly<Record<string, Pt>>,
  opts: PlanOptions,
): Arrow[] {
  const max = opts.max ?? ARROW_MAX;
  const has = (id: string): boolean =>
    positions instanceof Map ? positions.has(id) : id in (positions as Record<string, Pt>);
  const sorted = links
    .filter((l) => l.from !== l.to && has(l.from) && has(l.to) && opts.now >= l.at)
    .slice()
    .sort((a, b) => a.at - b.at);
  // packet budget is decided from arrival times only, so it is stable frame to frame
  const packetOk = new Map<string, boolean>();
  const starts: number[] = [];
  for (const l of sorted) {
    const recent = starts.filter((s) => l.at - s < PACKET_WINDOW_MS).length;
    const ok = recent < PACKET_MAX_PER_WINDOW;
    packetOk.set(l.messageId, ok);
    if (ok) starts.push(l.at);
  }
  const out: Arrow[] = [];
  for (const l of sorted) {
    const age = opts.now - l.at;
    if (age >= ARROW_LIFE_MS) continue;
    const label = KIND_LABEL[l.kind] ?? 'Message';
    const base = {
      key: l.messageId,
      from: l.from,
      to: l.to,
      kind: l.kind,
      label,
      title: `${a2aPartyName(l.from)} to ${a2aPartyName(l.to)}: ${label}`,
    };
    if (opts.calm) {
      out.push({ ...base, alpha: ARROW_CALM_ALPHA, packetT: null, static: true });
      continue;
    }
    const settled = ARROW_FADE_IN_MS + ARROW_PACKET_MS;
    const fadeStart = settled + ARROW_HOLD_MS;
    let alpha = ARROW_ALPHA * easeOut(age / ARROW_FADE_IN_MS);
    if (age > fadeStart) alpha = ARROW_ALPHA * (1 - easeOut((age - fadeStart) / ARROW_FADE_OUT_MS));
    const pk = (age - ARROW_FADE_IN_MS) / ARROW_PACKET_MS;
    const packetT = packetOk.get(l.messageId) && pk >= 0 && pk <= 1 ? easeInOut(pk) : null;
    out.push({ ...base, alpha: Math.max(0, alpha), packetT, static: false });
  }
  // newest `max` arrows win; same pair+direction keeps only its newest
  const seen = new Set<string>();
  const kept: Arrow[] = [];
  for (const a of out.reverse()) {
    const pair = `${a.from}>${a.to}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    if (kept.length < max) kept.push(a);
  }
  return kept.reverse();
}

/** Quadratic arc control point: bows to the left of the direction of travel (so A to B and B to A never overlap). */
export function arcControl(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(18, Math.max(6, len * 0.18));
  return { x: (a.x + b.x) / 2 + (dy / len) * bow, y: (a.y + b.y) / 2 - (dx / len) * bow };
}

export function arcAt(a: Pt, b: Pt, t: number): Pt {
  const c = arcControl(a, b);
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

/** Points of the arc, a to b. */
export function arcPoints(a: Pt, b: Pt, steps = 14): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => arcAt(a, b, i / steps));
}

/** Arrowhead triangle at b, pointing along the arc's end tangent. */
export function arrowHead(a: Pt, b: Pt, size = 4): [Pt, Pt, Pt] {
  const c = arcControl(a, b);
  const dx = b.x - c.x;
  const dy = b.y - c.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return [
    { x: b.x, y: b.y },
    { x: b.x - ux * size - uy * size * 0.6, y: b.y - uy * size + ux * size * 0.6 },
    { x: b.x - ux * size + uy * size * 0.6, y: b.y - uy * size - ux * size * 0.6 },
  ];
}

/* ---- room seats: council agent id -> seat ---- */
const ROLE_REF =
  /^(?:council:)?(ask|planner|roundtable|debate|quizkey|rubric|devilta|oral|oracle)-(.+)$/i;

export interface SeatRef {
  who: string;
  x: number;
  y: number;
}

/**
 * Councils a room seats. The Council Hall is the quiz-key room and also where the Ask council convenes (its
 * Skeptic, Teacher and Practitioner take the three member seats); the Round Table seats the planner council.
 */
export function roomCouncils(roomAgent: string): Set<string> {
  const room = roomAgent.replace(/^council:/, '').toLowerCase();
  if (room === 'quizkey') return new Set(['quizkey', 'ask']);
  if (room === 'planner') return new Set(['planner', 'roundtable']);
  return new Set([room]);
}

/** Council prefix and role of an agent id (`council:ask-skeptic` gives ask and skeptic). */
export function councilRole(id: string): { council: string; role: string } | undefined {
  const m = ROLE_REF.exec(id);
  return m ? { council: m[1]!.toLowerCase(), role: m[2]!.toLowerCase() } : undefined;
}

/**
 * Maps the agent ids of the links to seats of one room. `roomAgent` is the room's council id; links of another
 * council are skipped. The chair goes to the chair seat, a role to the seat whose speaker key is that role, and
 * any other role takes a free member seat in the order first seen. Returns feet positions (interior px).
 */
export function seatPositions(
  links: readonly ArrowLink[],
  seats: readonly SeatRef[],
  roomAgent: string,
): { positions: Map<string, Pt>; links: ArrowLink[] } {
  const room = roomCouncils(roomAgent);
  const members = seats.filter((s) => s.who !== 'chair');
  const taken = new Set<string>();
  const positions = new Map<string, Pt>();
  const assign = (id: string): void => {
    if (positions.has(id)) return;
    const r = councilRole(id);
    if (!r) return;
    let seat = seats.find((s) => s.who === r.role);
    if (!seat && r.role === 'chair') seat = seats.find((s) => s.who === 'chair');
    if (!seat) seat = members.find((s) => !taken.has(s.who));
    if (!seat) return;
    taken.add(seat.who);
    positions.set(id, { x: seat.x, y: seat.y });
  };
  const mine = links.filter((l) => {
    const a = councilRole(l.from);
    const b = councilRole(l.to);
    return !!a && !!b && room.has(a.council) && room.has(b.council);
  });
  for (const l of mine) {
    assign(l.from);
    assign(l.to);
  }
  return { positions, links: mine };
}
