import { useSyncExternalStore } from 'react';
import type { CouncilRunRecord } from '@squad/core';
import { modeInfo } from '@squad/village/council';

/**
 * Module store of the squad's stored council runs (`GET /v1/council/runs`), newest first. Reload-safe by construction:
 * the hub is the source of truth, nothing is kept in localStorage.
 */
export interface LastRunsState {
  runs: readonly CouncilRunRecord[];
  /** true once a fetch finished (even with an error), so "no run yet" is only said after we asked. */
  loaded: boolean;
  /** The last fetch failed (hub unreachable or older hub without the endpoint). */
  failed: boolean;
}
const INITIAL: LastRunsState = { runs: [], loaded: false, failed: false };
let state: LastRunsState = INITIAL;
const subs = new Set<() => void>();
const sub = (cb: () => void) => {
  subs.add(cb);
  return () => void subs.delete(cb);
};

export function setLastRuns(runs: readonly CouncilRunRecord[] | null): void {
  state = runs
    ? { runs, loaded: true, failed: false }
    : { runs: state.runs, loaded: true, failed: true };
  subs.forEach((f) => f());
}
/** Shared by the fetch helper so tests (and a reset on sign-out) start clean. */
export const fetchGate: { at: number; inflight: Promise<void> | null } = { at: 0, inflight: null };

export function resetLastRuns(): void {
  state = INITIAL;
  fetchGate.at = 0;
  fetchGate.inflight = null;
  historic.clear();
  subs.forEach((f) => f());
}
export const getLastRuns = (): LastRunsState => state;
export const useLastRunsState = (): LastRunsState =>
  useSyncExternalStore(sub, getLastRuns, () => INITIAL);

/** Runs that were put on the board from history (finished before this page looked), keyed by run id. */
export const historic = new Map<string, { startedAt: number; mode: string; councilKey: string }>();

/** Council keys per room, as the hub records them (`councilKey` of startRun). */
export const HALL_KEYS: readonly string[] = ['ask'];
export const ROUND_TABLE_KEYS: readonly string[] = ['roundtable', 'planner', 'courseplan'];

export function runsFor(s: LastRunsState, keys?: readonly string[]): readonly CouncilRunRecord[] {
  return keys ? s.runs.filter((r) => keys.includes(r.councilKey)) : s.runs;
}
export const lastRunOf = (
  s: LastRunsState,
  keys?: readonly string[],
): CouncilRunRecord | undefined => runsFor(s, keys)[0];

/** '4 min ago', 'just now', '2 h ago', '3 days ago'. */
export function agoWords(startedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - startedAt) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** 'Last council, 4 min ago, Live' / 'Last council, 4 min ago, Degraded: rate limited' / '..., Demo'. */
export function lastRunLabel(
  r: Pick<CouncilRunRecord, 'startedAt' | 'mode'> & { councilKey?: string },
  now: number,
  noun = 'council',
): string {
  return `Last ${noun}, ${agoWords(r.startedAt, now)}, ${modeInfo(r.mode).word}`;
}

/** Events that rebuild a stored run on the board / inspector: its envelopes, then the stage with the question. */
export function recordToEvents(rec: CouncilRunRecord): unknown[] {
  const ev: unknown[] = rec.messages.map((m) => ({ t: 'a2a.message', msg: m, mode: m.mode }));
  ev.push({
    t: 'council.stage',
    councilId: `council:${rec.councilKey}`,
    correlationId: rec.id,
    stage: rec.stage,
    mode: rec.mode,
    ...(rec.question ? { question: rec.question } : {}),
  });
  return ev;
}
