import {
  TripConflictSchema,
  TripViewV2Schema,
  type AgentState,
  type TripConflict,
  type TripMember,
  type TripOptionV2,
  type TripViewV2,
} from '@squad/core';

export type { TripConflict, TripMember, TripOptionV2, TripViewV2 };

/** Page-level events: the hub only ever says "something changed, refetch"; mock mode replays whole views. */
export type TripEvent =
  | { t: 'refresh' }
  | { t: 'trip.updated'; trip: TripViewV2 }
  | { t: 'trip.confirmed'; taskId: string };

export function parseTripView(raw: unknown): TripViewV2 | undefined {
  const p = TripViewV2Schema.safeParse(raw);
  return p.success ? p.data : undefined;
}

/** `GET /v1/trips/current` -> `{trip: view | null}`. `undefined` means the body is not that shape. */
export function parseCurrent(raw: unknown): { trip: TripViewV2 | null } | undefined {
  if (!raw || typeof raw !== 'object' || !('trip' in raw)) return undefined;
  const t = (raw as { trip: unknown }).trip;
  if (t === null) return { trip: null };
  const v = parseTripView(t);
  return v ? { trip: v } : undefined;
}

/** `{trip}` envelope returned by every mutation. */
export function parseTripEnvelope(raw: unknown): TripViewV2 | undefined {
  if (raw && typeof raw === 'object' && 'trip' in raw)
    return parseTripView((raw as { trip: unknown }).trip);
  return parseTripView(raw);
}

export function parseConflict(raw: unknown): TripConflict | undefined {
  const p = TripConflictSchema.safeParse(raw);
  return p.success ? p.data : undefined;
}

export function parseTripEvent(raw: unknown): TripEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { t?: string; type?: string; trip?: unknown; taskId?: string };
  const kind = r.t ?? r.type;
  if (kind === 'trip.updated' || kind === 'x.trip.updated') {
    const v = r.trip ? parseTripView(r.trip) : undefined;
    return v ? { t: 'trip.updated', trip: v } : { t: 'refresh' };
  }
  if (kind === 'trip.confirmed' && typeof r.taskId === 'string')
    return { t: 'trip.confirmed', taskId: r.taskId };
  return null;
}

export function tripReducer(state: TripViewV2 | null | undefined, ev: TripEvent) {
  if (ev.t === 'trip.updated') return state && state.tripId !== ev.trip.tripId ? state : ev.trip;
  return state;
}

export const money = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);

export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x as T);
  return next;
}

/** Default ranking: the options still in the running, in the order given (or the viewer's saved vote). */
export function initialRanking(view: TripViewV2): string[] {
  const open = view.options.filter((o) => !o.droppedReason).map((o) => o.id);
  if (!view.myVote) return open;
  const kept = view.myVote.filter((id) => open.includes(id));
  return [...kept, ...open.filter((id) => !kept.includes(id))];
}

export const agentLabel: Record<AgentState, string> = {
  online: 'Agent online',
  offline: 'Agent offline',
  no_agent: 'No agent',
  unknown: 'Agent unknown',
};

export const MODE_TITLE = {
  live: 'live: a real model wrote this wording',
  degraded: 'degraded: the model fell back partway, so the wording may be simpler',
  demo: 'demo: scripted rules, no model',
} as const;

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function optionMeta(o: TripOptionV2): string {
  return [
    o.estCost,
    o.days ? `${o.days} days` : undefined,
    o.perPerson !== undefined && !o.estCost ? `${money(o.perPerson)} each` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Build the create body from the form strings; undefined when the destination is too short. */
export function createBodyFromForm(f: {
  destination: string;
  month: string;
  days: string;
  perPerson: string;
}) {
  const destination = f.destination.trim();
  if (destination.length < 2) return undefined;
  const num = (s: string) =>
    s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Math.round(Number(s));
  const month = num(f.month);
  const days = num(f.days);
  const perPerson = num(f.perPerson);
  return {
    destination,
    ...(month ? { month } : {}),
    ...(days ? { days } : {}),
    ...(perPerson !== undefined ? { perPerson } : {}),
  };
}

const CUTSCENE_KEY = 'squad.trip.cutscene.';
/** True exactly once per tripId per browser (sessionStorage); false when storage is unavailable after the first claim. */
export function claimCutscene(tripId: string): boolean {
  try {
    if (sessionStorage.getItem(CUTSCENE_KEY + tripId)) return false;
    sessionStorage.setItem(CUTSCENE_KEY + tripId, '1');
    return true;
  } catch {
    return false;
  }
}
export const cutsceneHref = (taskId: string) =>
  `/squad/village?cutscene=trip&task=${encodeURIComponent(taskId)}`;
