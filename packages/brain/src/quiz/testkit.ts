import { FakeLlm, type InboundMessage, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createMasteryStore } from '../mastery/store';
import { QuizEngine, type QuizEngineOptions } from './engine';
import type { KeyVerifier } from './types';

export const CTX =
  '[ch3.pdf p.1] MSE is the mean of squared errors. [ch3.pdf p.2] The 2 comes from the derivative.';

export const QUESTIONS = {
  questions: [
    {
      kind: 'choice',
      question: 'What does MSE average?',
      choices: ['abs errors', 'squared errors', 'signs'],
      key: 1,
      explanation: 'MSE averages squared errors.',
      cite: { file: 'ch3.pdf', page: 1 },
    },
    {
      kind: 'free',
      question: 'Why is there a 2 in the MSE gradient?',
      key: 'derivative of the square',
      explanation: 'It comes from differentiating the square.',
    },
    {
      kind: 'choice',
      question: 'Which is smoother?',
      choices: ['MSE', 'MAE'],
      key: 0,
      explanation: 'MSE is smooth at zero.',
    },
  ],
};

export function makeEngine(over: Partial<QuizEngineOptions> & { llm?: FakeLlm } = {}) {
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const db = openMemoryDb();
  const llm =
    over.llm ??
    new FakeLlm({
      fallback: (req) => {
        const sys = req.system ?? '';
        if (sys.includes('grade a short answer'))
          return { correct: false, feedback: 'Think about the derivative.' };
        return QUESTIONS;
      },
    });
  let n = 0;
  const mastery = createMasteryStore({ db, emit, now: () => 1000 });
  const engine = new QuizEngine({
    db,
    llm,
    emit,
    mastery,
    chapters: { chapterContext: async () => CTX },
    now: () => 1000,
    newId: () => `q_${++n}`,
    ...over,
  });
  return { engine, events, db, llm, mastery };
}

export const acceptAll: KeyVerifier = { verify: async () => ({ ok: true, dissent: false }) };

export const msg = (over: Partial<InboundMessage>): InboundMessage => ({
  chatId: 'chat1',
  isGroup: true,
  from: 's_ana',
  text: '',
  attachments: [],
  mentionsBot: true,
  ts: 1,
  ...over,
});
