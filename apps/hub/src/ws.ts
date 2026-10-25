// STUB from the lead: the owning sub-agent replaces this file wholesale, keeping the exported names and signatures.
import type { Server } from 'node:http';
import type { HubDeps } from './types';
/** Attach the call websocket (/v1/call/ws/:callId) to the node http server. Returns a closer. */
export function attachCallWs(_server: Server, _deps: HubDeps): { close(): Promise<void> } {
  throw new Error('not implemented: attachCallWs');
}
