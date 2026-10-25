import { postEvent, agentId } from '@squad/core';
import type { StudentId } from '@squad/core';
import type { Emit } from './types';

export const defaultEmit: Emit = (e) => postEvent(e);

/** Called by brain-quiz's mastery writer, once per box move (see docs/brain-api.md). */
export async function emitMasteryChanged(
  emit: Emit,
  student: StudentId,
  chapter: string,
  box: number,
): Promise<void> {
  await emit({ t: 'mastery.changed', student, chapter, box });
}

/** agent.state studying -> idle around `fn`; idle is emitted even when fn throws. */
export async function withAgentState<T>(
  emit: Emit,
  agent: string,
  fn: () => Promise<T>,
  working: 'studying' | 'in_call' = 'studying',
): Promise<T> {
  await emit({ t: 'agent.state', agent, state: working });
  try {
    return await fn();
  } finally {
    await emit({ t: 'agent.state', agent, state: 'idle' });
  }
}

export const expertAgent = (chapter: string) => agentId.expert(chapter);
