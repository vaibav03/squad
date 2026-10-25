import type { SceneCommand } from '../contract';
import { initBase, reduceBase, type BaseState } from '../model/base';

/** Seat indexes: 0 left, 1 centre, 2 right (members); the chair is its own seat. */
export const CHAIR_SEAT = 3;

/** Members whose seat is fixed by name (03: solvers and planners); everyone else takes a free seat. */
const PINNED: Record<string, number> = {
  'solver-a': 0,
  'solver-b': 1,
  'solver-c': 2,
  chill: 0,
  grind: 1,
  advisor: 2,
  // the general-purpose ask council: Skeptic left, Teacher centre, Practitioner right
  skeptic: 0,
  teacher: 1,
  practitioner: 2,
};

export function isChair(member: string): boolean {
  const m = member.toLowerCase();
  return m === 'chair' || m === 'chairman';
}

export interface CouncilHallState extends BaseState {
  /** member -> seat (0..2), assigned on first appearance. */
  seats: Record<string, number>;
  /** Display order of opinion bubbles; slots slide from `from` to `to` over 320 ms on council.rank. */
  slots: { from: string[]; to: string[]; since: number } | null;
  /** Who last ranked, and when: that member talks for a moment. */
  speaker: { who: string; since: number } | null;
  /** Every council.rank of the current session, in arrival order (each shows its own rank bubble). */
  ranks: { by: string; order: string[]; since: number }[];
}

export function initCouncilHall(
  opts: { instance?: string; title?: string } = {},
): CouncilHallState {
  return {
    ...initBase({ ...opts, title: opts.title ?? 'Agent Hall', access: 'dim' }),
    seats: {},
    slots: null,
    speaker: null,
    ranks: [],
  };
}

/** Seat for `member` as the reducer would assign it (pure, order of first appearance). */
export function seatOf(seats: Readonly<Record<string, number>>, member: string): number {
  if (isChair(member)) return CHAIR_SEAT;
  const have = seats[member];
  if (have !== undefined) return have;
  const pinned = PINNED[member] ?? PINNED[member.toLowerCase()];
  const taken = new Set(Object.values(seats));
  if (pinned !== undefined && !taken.has(pinned)) return pinned;
  for (let i = 0; i < 3; i++) if (!taken.has(i)) return i;
  return Object.keys(seats).length % 3; // more than three members: wrap, never throw
}

function seat(s: CouncilHallState, member: string): CouncilHallState {
  if (isChair(member) || s.seats[member] !== undefined) return s;
  return { ...s, seats: { ...s.seats, [member]: seatOf(s.seats, member) } };
}

/** Members in seat order (left, centre, right) that have a seat. */
export function seated(s: CouncilHallState): string[] {
  return Object.entries(s.seats)
    .sort((a, b) => a[1] - b[1])
    .map(([m]) => m);
}

export function reduceCouncil(
  s: CouncilHallState,
  cmd: SceneCommand,
  at: number,
): CouncilHallState {
  switch (cmd.c) {
    case 'bubble':
      return seat(reduceBase(s, cmd, at), cmd.bubble.who);
    case 'rank': {
      // only seated members may appear in a ranking: free text in `order` never enters state
      const known = cmd.order.filter((m) => s.seats[m] !== undefined || m === cmd.by);
      const safe = { ...cmd, order: known };
      let n = reduceBase(seat(s, cmd.by), safe, at);
      for (const m of known) n = seat(n, m);
      const order = known.filter((m) => !isChair(m));
      const cur = n.slots?.to ?? seated(n);
      const rest = seated(n).filter((m) => !order.includes(m));
      return {
        ...n,
        slots: { from: cur, to: [...order, ...rest], since: at },
        speaker: { who: cmd.by, since: at },
        ranks: [...n.ranks, { by: cmd.by, order: [...known], since: at }],
      };
    }
    case 'verdict': {
      let n = reduceBase(s, cmd, at);
      if (cmd.dissenter) {
        n = seat(n, cmd.dissenter);
        const d = cmd.dissenter;
        const has = n.bubbles.some((b) => b.who === d);
        n = {
          ...n,
          bubbleQueue: n.bubbleQueue.map((q) =>
            q.bubble.who === d ? { ...q, bubble: { ...q.bubble, style: 'dissent' as const } } : q,
          ),
        };
        if (has) {
          // the dissenter's own bubble becomes the lone red-lined one, and stays
          n = {
            ...n,
            // since = now: the red-lined bubble re-enters (160 ms) even if the opinion had timed out
            bubbles: n.bubbles.map((b) =>
              b.who === d ? { ...b, style: 'dissent' as const, since: at } : b,
            ),
          };
        }
      }
      return n;
    }
    case 'clearBubbles':
      return { ...reduceBase(s, cmd, at), slots: null, speaker: null, ranks: [] };
    default:
      return reduceBase(s, cmd, at);
  }
}
