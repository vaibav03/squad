import { z } from 'zod';
import type { AgentId } from './types';

export const AgentIdSchema = z
  .string()
  .regex(/^(student|expert|council):[^\s:][^\s]*$|^(dean|mediator)$/, 'invalid AgentId');

export const agentId = {
  student: (id: string): AgentId => `student:${id}`,
  expert: (chapter: string): AgentId => `expert:${chapter}`,
  council: (id: string): AgentId => `council:${id}`,
  dean: 'dean' as AgentId,
  mediator: 'mediator' as AgentId,
};

export function parseAgentId(id: AgentId): { kind: string; ref?: string } {
  const i = id.indexOf(':');
  return i < 0 ? { kind: id } : { kind: id.slice(0, i), ref: id.slice(i + 1) };
}
