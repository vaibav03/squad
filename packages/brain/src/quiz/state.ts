import type { QuizPhase } from './types';

export type QuizTransition = 'posed' | 'all_answered' | 'advance' | 'finish';

const TABLE: Record<QuizPhase, Partial<Record<QuizTransition, QuizPhase>>> = {
  asking: { posed: 'collecting' },
  collecting: { all_answered: 'reveal' },
  reveal: { advance: 'next', finish: 'done' },
  next: { advance: 'asking' },
  done: {},
};

/** Pure transition function of the quiz state machine; throws on an illegal transition. */
export function nextPhase(phase: QuizPhase, t: QuizTransition): QuizPhase {
  const to = TABLE[phase][t];
  if (!to) throw new Error(`illegal quiz transition: ${phase} --${t}-->`);
  return to;
}

export const canTransition = (phase: QuizPhase, t: QuizTransition): boolean =>
  TABLE[phase][t] !== undefined;
