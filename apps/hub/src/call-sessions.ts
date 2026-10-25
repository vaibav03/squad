import type { CallSession } from './ports';
import type { HubDeps } from './types';

/** Open call sessions by callId, shared by the REST start route and the websocket. */
export const callSessions = new Map<string, CallSession>();
/** Calls whose websocket has connected. */
export const connectedCalls = new Set<string>();

/** Idempotent hang-up: closes the session, frees the registry slot and emits call.end and agent idle exactly once. */
export async function hangUp(deps: HubDeps, callId: string): Promise<boolean> {
  const call = deps.calls.get(callId);
  const session = callSessions.get(callId);
  callSessions.delete(callId);
  connectedCalls.delete(callId);
  if (!call) return false;
  deps.calls.close(callId);
  try {
    await session?.close();
  } catch {
    /* a failing session close must not block hanging up */
  }
  deps.ingest.village({ t: 'call.end', agent: call.agent, callId });
  deps.ingest.village({ t: 'agent.state', agent: call.agent, state: 'idle' });
  return true;
}
