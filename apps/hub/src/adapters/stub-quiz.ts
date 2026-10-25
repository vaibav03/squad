import type { StudentId } from '@squad/core';
import { BEN } from '../cast';
import type { QuizPayload, QuizPort } from '../ports';

interface Def {
  payload: QuizPayload;
  target?: StudentId;
  /** answer key and explanation stay in here; `get` never returns them */
  isCorrect(a: { choice?: string; text?: string }): boolean;
  explanation: string;
}

const DEFS: Def[] = [
  {
    payload: {
      quizId: 'qz_ch6_1',
      chapter: 'ch6',
      question: 'What are the mean and standard deviation of the standard normal distribution?',
      choices: [
        { id: 'a', text: 'Mean 1, standard deviation 0' },
        { id: 'b', text: 'Mean 0, standard deviation 1' },
        { id: 'c', text: 'Mean 0, standard deviation 0' },
        { id: 'd', text: 'Mean 1, standard deviation 1' },
      ],
    },
    isCorrect: (a) => a.choice === 'b',
    explanation: 'The standard normal distribution is centered at 0 with a spread of 1.',
  },
  {
    payload: {
      quizId: 'qz_ch6_2',
      chapter: 'ch6',
      question: 'In your own words, what does a z-score tell you about a value?',
    },
    target: BEN,
    isCorrect: (a) => /standard dev|deviation|distance|how many|far/i.test(a.text ?? ''),
    explanation: 'A z-score counts how many standard deviations a value sits from the mean.',
  },
];

export function createStubQuiz(): QuizPort {
  const answered = new Set<string>();
  const find = (id: string, viewer: StudentId) =>
    DEFS.find((d) => d.payload.quizId === id && (!d.target || d.target === viewer));
  return {
    async get(quizId, viewer) {
      const d = find(quizId, viewer);
      return d ? structuredClone(d.payload) : null;
    },
    async answer(quizId, viewer, a) {
      const d = find(quizId, viewer);
      if (!d) return null;
      const k = `${quizId}|${viewer}`;
      if (answered.has(k)) return { recorded: true, chapter: d.payload.chapter };
      answered.add(k);
      return {
        recorded: true,
        correct: d.isCorrect(a),
        explanation: d.explanation,
        chapter: d.payload.chapter,
      };
    },
    async listOpen(viewer) {
      return DEFS.filter(
        (d) => (!d.target || d.target === viewer) && !answered.has(`${d.payload.quizId}|${viewer}`),
      ).map((d) => ({
        quizId: d.payload.quizId,
        chapter: d.payload.chapter,
        ...(d.target ? { target: d.target } : {}),
      }));
    },
  };
}
