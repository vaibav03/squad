import { useSyncExternalStore } from 'react';
import type { CouncilBoardStore } from '@squad/village/council';

/**
 * The village page that owns the council board store registers it here so any council surface (Council Hall,
 * Round Table panel, council chat card, inspector, HUD button) can open the same board. With no registered store the
 * helpers do nothing and `useCanOpenBoard` is false, so the affordance is simply not offered.
 */
let store: CouncilBoardStore | null = null;
interface OpenState {
  open: boolean;
  /** Run to show; the latest run when absent. */
  runId?: string;
  /** Agent to focus in the org chart when the board opens. */
  agent?: string;
}
let state: OpenState = { open: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (cb: () => void) => {
  subs.add(cb);
  return () => void subs.delete(cb);
};

/** Window event other surfaces may fire (`detail: { runId?, agent? }`) when they have no import path to the bridge. */
export const COUNCIL_BOARD_EVENT = 'squad:council-board-open';

export function setBoardStore(s: CouncilBoardStore | null): void {
  if (store === s) return;
  store = s;
  if (!s) state = { open: false };
  emit();
}
export const getBoardStore = (): CouncilBoardStore | null => store;

export function openBoard(opts: { runId?: string; agent?: string } = {}): void {
  if (!store) return;
  if (opts.runId) store.selectRun(opts.runId);
  state = { open: true, ...opts };
  emit();
}
export function closeBoard(): void {
  if (!state.open) return;
  state = { open: false };
  emit();
}

export function useBoardStoreRef(): CouncilBoardStore | null {
  return useSyncExternalStore(
    sub,
    () => store,
    () => null,
  );
}
export function useBoardOpen(): OpenState {
  return useSyncExternalStore(
    sub,
    () => state,
    () => state,
  );
}
/** True when a board store is mounted on this page. */
export function useCanOpenBoard(): boolean {
  return useSyncExternalStore(
    sub,
    () => store !== null,
    () => false,
  );
}
/** Re-render on every board store change. */
export function useBoardVersion(s: CouncilBoardStore | null): number {
  return useSyncExternalStore(
    (cb) => (s ? s.subscribe(cb) : () => {}),
    () => s?.version ?? 0,
    () => 0,
  );
}
