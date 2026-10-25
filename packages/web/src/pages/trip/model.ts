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

const dollars = (v: unknown): number => {
  const n = Number.parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const nameOf = (id: string) => {
  const bare = id.replace(/^s_/, '');
  return bare.charAt(0).toUpperCase() + bare.slice(1);
};

/**
 * `GET /v1/trips/:tripId` (hub-api.md) -> the page's TripState. `fits` is computed here from the viewer's OWN limits
 * (the hub only sends those to their owner); the secret vote exposes only how many have voted.
 */
export function tripFromHub(raw: unknown, me: string): TripState | undefined {
  const h = raw as {
    tripId?: string;
    status?: string;
    dates?: string;
    options?: { id: string; label: string; estCost?: string }[];
    votes?: { student: string }[] | null;
    tallies?: Record<string, number> | null;
    vetoed?: { optionId: string }[];
    confirmations?: { student: string; confirmed: boolean }[];
    myLimits?: Record<string, string> | null;
  } | null;
  if (
    !h ||
    typeof h.tripId !== 'string' ||
    !Array.isArray(h.options) ||
    !Array.isArray(h.confirmations)
  )
    return undefined;
  const vetoed = new Set((h.vetoed ?? []).map((v) => v.optionId));
  const limits = h.myLimits ?? undefined;
  const budget = limits ? dollars(limits.budget) : undefined;
  const options = h.options.map((o) => {
    const total = dollars(o.estCost);
    return {
      id: o.id,
      name: o.label,
      dates: h.dates ?? '',
      total,
      fits: !vetoed.has(o.id) && (budget === undefined || budget === 0 || total <= budget),
      vetoed: vetoed.has(o.id),
    };
  });
  const lead = h.tallies
    ? Object.entries(h.tallies)
        .filter(([id]) => !vetoed.has(id))
        .sort((a, b) => b[1] - a[1])[0]?.[0]
    : undefined;
  return withDerived({
    tripId: h.tripId,
    title: 'Trip planner',
    options,
    members: h.confirmations.map((c) => ({
      id: c.student,
      name: nameOf(c.student),
      confirmed: c.confirmed,
    })),
    voted: h.votes?.length ?? 0,
    iVoted: !!h.votes?.some((v) => v.student === me),
    ...(lead ? { leadingOptionId: lead } : {}),
    ...(limits
      ? {
          myLimits: {
            budget: budget ?? 0,
            notes: Object.entries(limits)
              .filter(([k]) => k !== 'budget')
              .map(([k, v]) => `${nameOf(k)}: ${v}`),
          },
        }
      : {}),
    confirmed: h.status === 'confirmed',
  });
}
