import { z } from 'zod';
import type { Llm } from '@squad/core';
import type { QuestionDraft } from './types';

const RawQuestion = z.object({
  kind: z.enum(['choice', 'free']),
  question: z.string().min(3),
  choices: z.array(z.string().min(1)).min(2).max(6).optional(),
  key: z.union([z.number().int(), z.string().min(1)]),
  explanation: z.string().optional(),
  cite: z.object({ file: z.string(), page: z.number().int().optional() }).optional(),
});
export const QuestionsSchema = z.object({ questions: z.array(RawQuestion) });

export const QUIZ_PROMPT_VERSION = 'quizgen-v1';

/** Validate and normalise one raw model question into a draft, or null when unusable. */
export function toDraft(raw: z.infer<typeof RawQuestion>): QuestionDraft | null {
  if (raw.kind === 'choice') {
    const n = raw.choices?.length ?? 0;
    const key = typeof raw.key === 'number' ? raw.key : Number(raw.key);
    if (n < 2 || !Number.isInteger(key) || key < 0 || key >= n) return null;
    return { ...base(raw), kind: 'choice', choices: raw.choices!, key };
  }
  return { ...base(raw), kind: 'free', key: String(raw.key) };
}
const base = (raw: z.infer<typeof RawQuestion>) => ({
  question: raw.question,
  ...(raw.explanation ? { explanation: raw.explanation } : {}),
  ...(raw.cite ? { cite: raw.cite } : {}),
});

export async function generateDrafts(
  llm: Llm,
  chapterContext: string,
  count: number,
  avoid: string[] = [],
): Promise<QuestionDraft[]> {
  const res = await llm.json({
    model: 'main',
    system: `You write quiz questions from course material only. [prompt ${QUIZ_PROMPT_VERSION}]`,
    messages: `Chapter material:\n${chapterContext}\n\nWrite ${count} questions (mix of "choice" with a 0-based index key, and "free" with a short reference answer). Each must be answerable from the material. Include a one-sentence explanation and cite {file, page}. Avoid repeating: ${avoid.join(' | ') || 'none'}.\nReturn {"questions": [...]}.`,
    schema: QuestionsSchema,
    temperature: 0,
  });
  return res.questions.map(toDraft).filter((d): d is QuestionDraft => d !== null);
}
