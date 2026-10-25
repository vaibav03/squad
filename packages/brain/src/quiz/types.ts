import { z } from 'zod';
import type { StudentId } from '@squad/core';

export type QuizVia = 'imessage' | 'village';
export type QuizPhase = 'asking' | 'collecting' | 'reveal' | 'next' | 'done';

/** What GET /v1/quiz/:quizId returns. NEVER contains the key. */
export const QuizPayloadSchema = z.strictObject({
  quizId: z.string(),
  chapter: z.string(),
  index: z.number().int().min(0),
  kind: z.enum(['choice', 'free']),
  question: z.string(),
  choices: z.array(z.string()).optional(),
});
export type QuizPayload = z.infer<typeof QuizPayloadSchema>;

/** POST /v1/quiz/:quizId/answer body: exactly one of choice | text. No confidence field. */
export const AnswerPayloadSchema = z.union([
  z.strictObject({ choice: z.number().int().min(0) }),
  z.strictObject({ text: z.string().min(1) }),
]);
export type AnswerPayload = z.infer<typeof AnswerPayloadSchema>;

/** Private feedback for the answering student only. */
export interface AnswerFeedback {
  correct: boolean;
  feedback: string;
}

/** Text a free-form helper gets from the in-chat transport (iMessage): "B" / "2" / free text -> AnswerPayload. */
export interface QuestionDraft {
  kind: 'choice' | 'free';
  question: string;
  choices?: string[];
  /** The key: choice index for 'choice', reference answer for 'free'. Server side only. */
  key: number | string;
  explanation?: string;
  cite?: { file: string; page?: number };
}

/** Chapter material, provided by brain-answers' ingest (stubbed locally until it lands). */
export interface ChapterProvider {
  /** Pages joined with `[file p.N]` markers; empty string if unknown. */
  chapterContext(courseId: string, chapter: string): Promise<string>;
  /** Known page text lookups for citation checks of explanations (optional). */
  pageText?(courseId: string, chapter: string, file: string, page: number): string | undefined;
}

/** Result of the quiz-key council (council:quizkey). */
export interface KeyVerdict {
  /** true when the 3 blind solvers agree with the key; false => question dropped ("uncertain"). */
  ok: boolean;
  dissent: boolean;
  dissenter?: string;
}

/** Implemented by councils/; the engine only depends on this. */
export interface KeyVerifier {
  verify(draft: QuestionDraft, ctx: { courseId: string; chapter: string; chapterContext: string }): Promise<KeyVerdict>;
}

export type { StudentId };
