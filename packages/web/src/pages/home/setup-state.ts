import { useCallback, useEffect, useRef, useState } from 'react';
import { timedFetch } from '../../lib/http';
import { parseConnections } from '../connections/api';
import { calendarUsable } from '../connections/connection-state';

/**
 * The Home "Get set up" checklist is derived ONLY from what the hub says about the signed-in viewer.
 * No localStorage flags, no demo steps, no defaults: an item is 'loading' until its own read settles,
 * 'done' / 'todo' from the answer, and 'error' when the read failed (each read is bounded by timedFetch).
 */
export type SetupKey = 'phone' | 'courses' | 'calendar' | 'persona';
export type ItemState = 'loading' | 'done' | 'todo' | 'error';
export type SetupStates = Record<SetupKey, ItemState>;
export const SETUP_KEYS: readonly SetupKey[] = ['phone', 'courses', 'calendar', 'persona'];

export interface HubCtx {
  hubUrl: string | null;
  token: string | null;
}

export async function getJson(ctx: HubCtx, path: string): Promise<unknown> {
  if (!ctx.hubUrl) throw new Error('no_hub');
  const res = await timedFetch(`${ctx.hubUrl.replace(/\/+$/, '')}${path}`, {
    headers: ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {},
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** GET /v1/imessage/link: the viewer's linked handles. Only the count is used, never the masked hint. */
export async function phoneDone(ctx: HubCtx): Promise<boolean> {
  if (arr(obj(await getJson(ctx, '/v1/imessage/link')).links).length > 0) return true;
  // A phone verified at sign-up (no iMessage link yet) is also real server state: GET /v1/me phoneVerified.
  return obj(await getJson(ctx, '/v1/me')).phoneVerified === true;
}

/** GET /v1/library/courses: at least one of the viewer's own, non-sample courses whose ingest finished (status ready). */
export async function coursesDone(ctx: HubCtx): Promise<boolean> {
  const courses = arr(obj(await getJson(ctx, '/v1/library/courses')).courses).map(obj);
  if (courses.some((c) => c.sample !== true && c.status === 'ready')) return true;
  // Connecting Canvas for real is the lead way to add courses: a live (not practice) Canvas connection counts.
  try {
    return arr(obj(await getJson(ctx, '/v1/connections')).connections)
      .map(obj)
      .some(
        (c) => c.provider === 'canvas' && c.mode === 'live' && (c.state ?? c.status) === 'live',
      );
  } catch {
    return false;
  }
}

/** A live (not fixture, not expired/revoked) Google calendar or Canvas calendar feed, or a real .ics ingested. */
export async function calendarDone(ctx: HubCtx): Promise<boolean> {
  const [conns, ics] = await Promise.allSettled([
    getJson(ctx, '/v1/connections'),
    getJson(ctx, '/v1/squad/calendar'),
  ]);
  if (ics.status === 'fulfilled' && obj(ics.value).ics === true) return true;
  if (conns.status === 'fulfilled') {
    // the same state machine as the Connections page: a real, usable (connected or syncing) calendar source
    if (calendarUsable(parseConnections(conns.value))) return true;
  }
  // Not provably done: only report "to do" when both reads answered, otherwise surface the failure.
  if (conns.status === 'rejected') throw conns.reason as Error;
  if (ics.status === 'rejected') throw ics.reason as Error;
  return false;
}

/** GET /v1/me: a persona the viewer's account actually has. */
export async function personaDone(ctx: HubCtx): Promise<boolean> {
  const user = obj(obj(await getJson(ctx, '/v1/me')).user);
  return typeof user.personaId === 'string' && user.personaId !== '';
}

const READERS: Record<SetupKey, (ctx: HubCtx) => Promise<boolean>> = {
  phone: phoneDone,
  courses: coursesDone,
  calendar: calendarDone,
  persona: personaDone,
};

const ALL = (s: ItemState): SetupStates => ({ phone: s, courses: s, calendar: s, persona: s });

/** Each item settles on its own; one slow or failing read never holds back the others. */
export function useSetupChecklist(
  ctx: HubCtx,
  /** The shared hub bootstrap has not finished: stay `loading` instead of reporting `todo` for a missing session. */
  waiting = false,
): {
  states: SetupStates;
  retry: () => void;
  anyError: boolean;
} {
  const live = !!ctx.hubUrl && !!ctx.token;
  const [states, setStates] = useState<SetupStates>(() =>
    ALL(live || waiting ? 'loading' : 'todo'),
  );
  const gen = useRef<Record<SetupKey, number>>({ phone: 0, courses: 0, calendar: 0, persona: 0 });
  const { hubUrl, token } = ctx;
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  const load = useCallback(
    (keys: readonly SetupKey[]) => {
      if (!hubUrl || !token) {
        for (const k of keys) gen.current[k]++;
        setStates(ALL(waitingRef.current ? 'loading' : 'todo')); // no hub session: nothing server-side can be done yet
        return;
      }
      setStates((prev) => {
        const next = { ...prev };
        for (const k of keys) next[k] = 'loading';
        return next;
      });
      for (const k of keys) {
        const id = ++gen.current[k];
        READERS[k]({ hubUrl, token }).then(
          (ok) => {
            if (gen.current[k] === id) setStates((p) => ({ ...p, [k]: ok ? 'done' : 'todo' }));
          },
          () => {
            if (gen.current[k] === id) setStates((p) => ({ ...p, [k]: 'error' }));
          },
        );
      }
    },
    [hubUrl, token],
  );

  useEffect(() => {
    load(SETUP_KEYS);
  }, [load]);

  const retry = useCallback(
    () => load(SETUP_KEYS.filter((k) => states[k] === 'error')),
    [load, states],
  );
  return { states, retry, anyError: SETUP_KEYS.some((k) => states[k] === 'error') };
}
