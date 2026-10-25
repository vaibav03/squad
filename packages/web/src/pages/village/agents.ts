import { agentFromId } from '../../overlays/call-state';
import type { CallAgent } from '../../overlays/types';
import { pixelPortrait } from '../../pixel/portraits';

/** Pixel portrait for a hub agent id ('expert:ch5' -> expert, 'council:q1' -> council, 'student:ana' -> student). */
export function agentPortrait(agentId: string): string | undefined {
  const kind = agentId.split(':')[0] ?? agentId;
  return pixelPortrait(agentId) ?? pixelPortrait(kind);
}
export function callAgent(agentId: string): CallAgent {
  return agentFromId(agentId, { portrait: agentPortrait(agentId) });
}
