import { announceCouncilStarted as announce } from './stage/room-opener';

/** Window event fired once a council run was accepted by the hub (the Council Hall auto-open listens to it). */
export { COUNCIL_STARTED_EVENT, type CouncilStartedDetail } from './stage/room-opener';

const announced = new Set<string>();
/** Fires the event once per run id, whichever start path (CTA, panel, board, chat card) saw the run first. */
export function announceCouncilStarted(id: string, transport?: 'stream' | 'live'): void {
  if (typeof window === 'undefined' || announced.has(id)) return;
  announced.add(id);
  announce({ id, councilKey: 'ask', ...(transport ? { transport } : {}) });
}
