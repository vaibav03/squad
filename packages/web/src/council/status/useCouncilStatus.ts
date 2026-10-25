import { useCallback, useEffect, useState } from 'react';
import type { CouncilStatus } from '@squad/core';
import type { HubCtx } from '../../pages/village/hub';
import { getCouncilStatus } from './api';

export const STATUS_REFRESH_MS = 30_000;

export interface CouncilStatusState {
  /** null while loading or without a hub; 'unknown' when the endpoint is missing or unreachable. */
  status: CouncilStatus | null | 'unknown';
  refresh(): void;
}

/** `GET /v1/council/status`, refreshed every 30 s, on demand and when a council run starts. Fixtures (no hub) stay `null`. */
export function useCouncilStatus(hub: HubCtx | null | undefined): CouncilStatusState {
  const [status, setStatus] = useState<CouncilStatus | null | 'unknown'>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const url = hub?.hubUrl;
  const token = hub?.token;
  useEffect(() => {
    if (!hub) {
      setStatus(null);
      return;
    }
    let live = true;
    const load = () =>
      void getCouncilStatus(hub).then((s) => {
        if (live) setStatus(s ?? 'unknown');
      });
    load();
    const t = setInterval(load, STATUS_REFRESH_MS);
    const on = () => load();
    window.addEventListener('squad:council-started', on);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener('squad:council-started', on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token, tick]);
  return { status, refresh };
}
