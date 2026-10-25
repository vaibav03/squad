import { useCallback, useEffect, useState } from 'react';
import type { HealthReport } from '@squad/core';
import { useSquadConfig } from '../../shell/context';
import { fetchHealth } from './api';

export interface HealthState {
  state: 'demo' | 'loading' | 'ready' | 'unreachable';
  report: HealthReport | null;
  error: string | null;
  rerun: () => Promise<void>;
  hub: { hubUrl: string; token: string | null } | null;
}

/** Runs the REAL probes on the hub each time (no cache, no static badge). Without a live hub: demo, nothing invented. */
export function useHealth(reloadKey: unknown = 0): HealthState {
  const cfg = useSquadConfig();
  const live = cfg.mode === 'live' && !!cfg.hubUrl && !!cfg.token;
  const hub = live ? { hubUrl: cfg.hubUrl!, token: cfg.token } : null;
  const [state, setState] = useState<HealthState['state']>(live ? 'loading' : 'demo');
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async () => {
    if (!hub) return;
    try {
      setReport(await fetchHealth(hub));
      setError(null);
      setState('ready');
    } catch (e) {
      setError((e as Error).message);
      setState('unreachable');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub?.hubUrl, hub?.token]);
  useEffect(() => {
    if (!live) {
      setState('demo');
      return;
    }
    void run();
  }, [live, run, reloadKey]);
  return { state, report, error, rerun: run, hub };
}
