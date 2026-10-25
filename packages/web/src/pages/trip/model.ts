import { z } from 'zod';
import { meetsMinGroupSize } from '@squad/core';

export const TripOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  dates: z.string(),
  total: z.number(),
  /** Does it fit the VIEWER's private limits. Computed server-side; the limits themselves are not in options. */
  fits: z.boolean(),
  vetoed: z.boolean().default(false),
});
export type TripOption = z.infer<typeof TripOptionSchema>;

export const TripStateSchema = z.object({
  tripId: z.string(),
  title: z.string(),
  options: z.array(TripOptionSchema),
  members: z.array(z.object({ id: z.string(), name: z.string(), confirmed: z.boolean() })),
  /** Secret vote: only how many have voted, never who or what. */
  voted: z.number(),
  iVoted: z.boolean(),
  /** The option the squad is converging on (mediator result), if any. */
  leadingOptionId: z.string().optional(),
  /** Viewer's own limits only. Absent for everyone else by construction. */
  myLimits: z.object({ budget: z.number(), notes: z.array(z.string()) }).optional(),
  confirmed: z.boolean().default(false),
});
export type TripState = z.infer<typeof TripStateSchema>;

export type TripEvent =
  | { t: 'trip.updated'; trip: TripState }
  | { t: 'trip.confirmed'; taskId: string; squadId: string }
  | { t: 'x.other' };

export function tripReducer(state: TripState, ev: TripEvent): TripState {
  if (ev.t === 'trip.updated')
    return ev.trip.tripId === state.tripId ? withDerived(ev.trip) : state;
  if (ev.t === 'trip.confirmed') {
    return ev.taskId === state.tripId
      ? {
          ...state,
          confirmed: true,
          members: state.members.map((m) => ({ ...m, confirmed: true })),
        }
      : state;
  }
  return state;
}

export function withDerived(t: TripState): TripState {
  const all = t.members.length > 0 && t.members.every((m) => m.confirmed);
  return all && !t.confirmed ? { ...t, confirmed: true } : t;
}

export function parseTripEvent(raw: unknown): TripEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { t?: string; trip?: unknown; taskId?: string; squadId?: string };
  if (r.t === 'trip.updated') {
    const p = TripStateSchema.safeParse(r.trip);
    return p.success ? { t: 'trip.updated', trip: p.data } : null;
  }
  if (r.t === 'trip.confirmed' && typeof r.taskId === 'string' && typeof r.squadId === 'string')
    return { t: 'trip.confirmed', taskId: r.taskId, squadId: r.squadId };
  return null;
}

/** Even split in whole dollars; the remainder dollars go to the first members so the shares add up exactly. */
export function splitTotal(total: number, people: number): number[] {
  if (people <= 0) return [];
  const base = Math.floor(total / people);
  const extra = total - base * people;
  return Array.from({ length: people }, (_, i) => base + (i < extra ? 1 : 0));
}

export const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

export function showVoteCounts(memberCount: number) {
  return meetsMinGroupSize(memberCount);
}

/** Default ranking: open options in the order given. */
export function initialRanking(options: readonly TripOption[]): string[] {
  return options.filter((o) => !o.vetoed).map((o) => o.id);
}

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}
