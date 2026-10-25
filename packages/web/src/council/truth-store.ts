import { useSyncExternalStore } from 'react';
import type { CouncilTruth } from '@squad/core';
import { resultMode } from './board/mode-of';

// What each council card the viewer has loaded actually is (live, fixture, degraded). The chat header reads this so it
// never says plain "Live" next to an example council. Keyed by run id.
const truths = new Map<string, CouncilTruth>();
const subs = new Set<() => void>();
let version = 0;

export function councilTruthOf(r: Parameters<typeof resultMode>[0]): CouncilTruth {
  const m = resultMode(r);
  return m.startsWith('demo') ? 'fixture' : m.startsWith('degraded') ? 'degraded' : 'live';
}

export function noteCouncilTruth(runId: string, t: CouncilTruth): void {
  if (truths.get(runId) === t) return;
  truths.set(runId, t);
  version++;
  for (const s of subs) s();
}

export const councilTruthFor = (runId: string): CouncilTruth | undefined => truths.get(runId);

/** Re-renders when any council truth changes; returns a snapshot version. */
export function useCouncilTruthVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => version,
    () => 0,
  );
}
