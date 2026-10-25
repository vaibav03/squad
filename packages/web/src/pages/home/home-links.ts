import { useEffect, useState } from 'react';
import { timedFetch } from '../../lib/http';
import { parseCurrent } from '../trip/model';
import { HOME_STATIC_LINKS } from './fixtures';

export interface HomeLink {
  to: string;
  icon: string;
  title: string;
  body: string;
}

/** What the squad's real state says about its trip. `unknown` is "not asked yet / could not ask". */
export type TripTarget =
  | { kind: 'unknown' }
  | { kind: 'none' }
  | { kind: 'trip'; tripId: string; title: string; status: string };

const TERMINAL = new Set(['failed', 'expired', 'cancelled']);

/** Resolves every Home card from real state at render time. Pure: no hard-coded demo ids. */
export function resolveHomeLinks(trip: TripTarget): HomeLink[] {
  const tripCard: HomeLink =
    trip.kind === 'trip'
      ? {
          to: `/squad/trips/${encodeURIComponent(trip.tripId)}`,
          icon: 'plane',
          title: trip.title,
          body: 'Vote on options and confirm when you are in.',
        }
      : trip.kind === 'none'
        ? {
            to: '/squad/trips',
            icon: 'plane',
            title: 'Plan a trip',
            body: 'No trip planned yet. Start one and let your squad vote.',
          }
        : {
            to: '/squad/trips',
            icon: 'plane',
            title: 'Trip',
            body: 'Your squad trip lives here.',
          };
  const [glass, ...rest] = HOME_STATIC_LINKS as readonly HomeLink[];
  return [glass!, tripCard, ...rest];
}

/** GET /v1/trips/current (`{ trip: null }` is a normal answer). Demo/mock mode and failures leave it `unknown`. */
export function useCurrentTrip(
  hubUrl: string | null,
  token: string | null,
  enabled: boolean,
): TripTarget {
  const [target, setTarget] = useState<TripTarget>({ kind: 'unknown' });
  useEffect(() => {
    if (!enabled || !hubUrl || !token) return;
    let live = true;
    void (async () => {
      try {
        const res = await timedFetch(`${hubUrl.replace(/\/+$/, '')}/v1/trips/current`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const cur = parseCurrent(await res.json());
        if (!live || !cur) return;
        const t = cur.trip;
        setTarget(
          t && !TERMINAL.has(String(t.status))
            ? { kind: 'trip', tripId: t.tripId, title: t.title, status: String(t.status) }
            : { kind: 'none' },
        );
      } catch {
        /* keep `unknown`: the card points at /squad/trips, which always renders */
      }
    })();
    return () => {
      live = false;
    };
  }, [hubUrl, token, enabled]);
  return target;
}
