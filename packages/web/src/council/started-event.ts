/** Window event fired once a council run was accepted by the hub (the Council Hall auto-open listens to it). */
export const COUNCIL_STARTED_EVENT = 'squad:council-started';
export interface CouncilStartedDetail {
  id: string;
  councilKey: 'ask';
  /** What the caller asked for; absent when the hub's default decides. */
  transport?: 'stream' | 'live';
}

const announced = new Set<string>();
/** Fires the event once per run id, whichever start path (CTA, panel, board, chat card) saw the run first. */
export function announceCouncilStarted(id: string, transport?: 'stream' | 'live'): void {
  if (typeof window === 'undefined' || announced.has(id)) return;
  announced.add(id);
  window.dispatchEvent(
    new CustomEvent<CouncilStartedDetail>(COUNCIL_STARTED_EVENT, {
      detail: { id, councilKey: 'ask', ...(transport ? { transport } : {}) },
    }),
  );
}
