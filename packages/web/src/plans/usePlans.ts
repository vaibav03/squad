import { useCallback, useEffect, useState } from 'react';
import { timedFetch } from '../lib/http';
import { useSquadConfig } from '../shell/context';
import { healFromTrips } from '../pages/village/trip-cutscene';
import { parsePlans, type PlanSummary } from './model';

export interface PlansState {
  plans: PlanSummary[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

/** Trips and the current study plan of the viewer's squad, from the hub (no new endpoints). */
export function usePlans(
  hub: { hubUrl: string; token: string | null } | null,
  on: boolean,
): PlansState {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [n, setN] = useState(0);
  const viewer = useSquadConfig().userId ?? 'anon';
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!on || !hub) return;
    let dead = false;
    const headers: Record<string, string> = hub.token
      ? { Authorization: `Bearer ${hub.token}` }
      : {};
    const get = async (path: string): Promise<unknown> => {
      const r = await timedFetch(`${hub.hubUrl}${path}`, { headers });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    };
    setLoading(true);
    setError(false);
    Promise.all([get('/v1/trips'), get('/v1/plans/current').catch(() => null)])
      .then(([t, c]) => {
        // a trip confirmed while the Village was closed is remembered, so its cutscene plays on the next visit
        healFromTrips(viewer, t);
        if (!dead) setPlans(parsePlans(t, c));
      })
      .catch(() => !dead && setError(true))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [hub?.hubUrl, hub?.token, on, n]); // eslint-disable-line react-hooks/exhaustive-deps
  return { plans, loading, error, reload };
}
