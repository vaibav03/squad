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
      quizId: 'qz_ch5_1',
      chapter: 'ch5',
      question: 'Which structure gives O(1) average-time lookup by key?',
      choices: [
        { id: 'a', text: 'Sorted array' },
        { id: 'b', text: 'Hash table' },
        { id: 'c', text: 'Linked list' },
        { id: 'd', text: 'Binary heap' },
      ],
    },
    isCorrect: (a) => a.choice === 'b',
    explanation: 'A hash table maps keys to buckets, so lookups are O(1) on average.',
  },
  {
    payload: {
      quizId: 'qz_ch5_2',
      chapter: 'ch5',
      question: 'In your own words, why does amortized analysis matter for dynamic arrays?',
    },
    target: BEN,
    isCorrect: (a) => /amortiz|average|resiz|double/i.test(a.text ?? ''),
    explanation: 'Occasional O(n) resizes are spread across many O(1) appends.',
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
