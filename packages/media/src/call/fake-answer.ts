import type { Citation } from '@squad/core';
import type { AnswerFn } from './types';

export const FIXTURE_CITE: Citation = {
  courseId: 'demo',
  chapter: 'ch5',
  file: 'ch5.pdf',
  page: 12,
};

/** Deterministic brain stand-in: two sentences, the last carrying a citation. */
export const fakeAnswer: AnswerFn = async ({ text }) => [
  { text: `You asked: ${text.slice(0, 60)}.` },
  { text: 'The key idea is on page 12.', cite: FIXTURE_CITE },
];
