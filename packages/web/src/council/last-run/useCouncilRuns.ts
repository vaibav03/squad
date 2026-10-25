import { useCallback, useEffect } from 'react';
import type { CouncilRunRecord } from '@squad/core';
import type { CouncilBoardStore } from '@squad/village/council';
import type { InspectorStore } from '@squad/village/inspector';
import type { HubCtx } from '../../pages/village/hub';
import { getCouncilRuns } from '../status/api';
import {
  fetchGate,
  historic,
  recordToEvents,
  runsFor,
  setLastRuns,
  useLastRunsState,
  type LastRunsState,
} from './store';

const MIN_GAP_MS = 800;
const RUNNING_POLL_MS = 4000;

/** One shared fetch of the stored runs (deduped), written to the module store. */
export async function refreshCouncilRuns(hub: HubCtx, force = false): Promise<void> {
  const t = Date.now();
  if (fetchGate.inflight) return fetchGate.inflight;
  if (!force && t - fetchGate.at < MIN_GAP_MS) return;
  fetchGate.at = t;
  fetchGate.inflight = getCouncilRuns(hub)
    .then((runs) => setLastRuns(runs))
    .finally(() => {
      fetchGate.inflight = null;
    });
  return fetchGate.inflight;
}

export interface CouncilRunsApi extends LastRunsState {
  /** Runs of this room's council (all when no keys), newest first. */
  mine: readonly CouncilRunRecord[];
  last: CouncilRunRecord | undefined;
  refresh(): void;
}

/**
 * The squad's stored council runs. Loads on mount, again when a run starts (`squad:council-started`), and keeps
 * polling gently while the newest run is still running, so the last run is always current after a reload.
 */
export function useCouncilRuns(
  hub: HubCtx | null | undefined,
  keys?: readonly string[],
): CouncilRunsApi {
  const s = useLastRunsState();
  const url = hub?.hubUrl;
  const token = hub?.token;
  const refresh = useCallback(() => {
    if (hub) void refreshCouncilRuns(hub, true);
  }, [hub]);
  useEffect(() => {
    if (!hub) return;
    void refreshCouncilRuns(hub);
    const on = () => {
      setTimeout(() => void refreshCouncilRuns(hub, true), 1200);
    };
    window.addEventListener('squad:council-started', on);
    return () => window.removeEventListener('squad:council-started', on);
  }, [url, token]);
  const running = s.runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!hub || !running) return;
    const t = setInterval(() => void refreshCouncilRuns(hub, true), RUNNING_POLL_MS);
    return () => clearInterval(t);
  }, [hub, running]);
  const mine = runsFor(s, keys);
  return { ...s, mine, last: mine[0], refresh };
}

/**
 * Puts the stored runs on the board and into the inspector when nothing live has reached them (a reload, a fresh
 * page). A live run always wins: when the board already has runs nothing is folded in.
 */
export function hydrateFromHistory(
  runs: readonly CouncilRunRecord[],
  board: CouncilBoardStore | null,
  inspector?: InspectorStore | null,
): void {
  if (!board || board.runs().length > 0) return;
  for (const rec of [...runs].reverse()) {
    if (rec.messages.length === 0) continue;
    for (const e of recordToEvents(rec)) {
      board.apply(e);
      if ((e as { t?: string }).t === 'a2a.message') inspector?.apply(e);
    }
    if (rec.status !== 'running')
      historic.set(rec.id, {
        startedAt: rec.startedAt,
        mode: rec.mode,
        councilKey: rec.councilKey,
      });
  }
}
