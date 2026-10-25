import type { CouncilAskResponse, CouncilStatus } from '@squad/core';
import type { HubCtx } from '../pages/village/hub';
import { askCouncil } from './council-client';
import { announceCouncilStarted } from './started-event';

export { COUNCIL_STARTED_EVENT } from './started-event';
export type { CouncilStartedDetail } from './started-event';

export const DEFAULT_CONVENE_QUESTION = 'What is the most important idea in this chapter?';

/**
 * The one way a council run starts from the UI (empty-state CTA, panel buttons, board launchers, chat). Posts the ask,
 * then announces it so other surfaces (hall auto-open, status refresh, last-run sync) react. Returns the hub response.
 */
export async function startCouncilRun(o: {
  hub: HubCtx;
  question: string;
  transport?: 'stream' | 'live';
  chatId?: string;
}): Promise<CouncilAskResponse> {
  const transport = o.transport ?? 'stream';
  const res = await askCouncil(o.hub, {
    question: o.question,
    ...(o.chatId ? { chatId: o.chatId } : {}),
    transport,
  });
  announceCouncilStarted(res.id, transport);
  return res;
}

/**
 * Which transport a start asks for: Live only when the hub has it enabled, its last attempt did not fail AND the user's
 * "Use Gemini Live" toggle is on; otherwise streaming (the server runs a labelled demo run when there is no key).
 */
export function chooseStartTransport(
  status: CouncilStatus | null | 'unknown',
  useLive: boolean,
): 'stream' | 'live' {
  if (status === null || status === 'unknown') return 'stream';
  const l = status.transports.live;
  return useLive && l.enabled && l.state !== 'unavailable' ? 'live' : 'stream';
}

/** Default of the "Use Gemini Live" toggle: on only when the hub's own default is live. */
export const defaultUseLive = (status: CouncilStatus | null | 'unknown'): boolean =>
  status !== null && status !== 'unknown' && status.defaultTransport === 'live';
