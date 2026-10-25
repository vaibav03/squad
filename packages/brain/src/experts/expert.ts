import { z } from 'zod';
import type { Llm } from '@squad/core';
import { renderAnswer, verifyClaims } from '../citations';
import type { CourseStore } from '../ingest/types';
import { BrainUnavailableError } from './errors';
import { loadPrompt } from './prompts';
import { expertAgent, withAgentState } from './emit';
import {
  NOT_IN_MATERIALS,
  type ChapterExpert,
  type Claim,
  type ContextProvider,
  type Emit,
  type ExpertAnswer,
} from './types';

export const MAX_CLAIMS = 4;
const TASK = loadPrompt(import.meta.url, 'expert.task.md');

export const ExpertOutputSchema = z.object({
  answer: z.string().default(''),
  claims: z
    .array(
      z.object({
        text: z.string(),
        file: z.string(),
        page: z.number(),
        quote: z.string(),
      }),
    )
    .max(12),
});

export interface ExpertDeps {
  llm: Llm;
  store: CourseStore;
  contexts: ContextProvider;
  emit: Emit;
}

/** Calls the model twice at most (one repair retry on bad JSON); throws BrainUnavailableError. */
async function askModel(
  llm: Llm,
  system: string | undefined,
  cache: import('@squad/core').CacheHandle | undefined,
  question: string,
) {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await llm.json({
        model: 'main',
        system,
        cache,
        messages: `${TASK}\n\nStudent question: ${question}`,
        schema: ExpertOutputSchema,
        temperature: 0,
      });
    } catch (e) {
      last = e;
    }
  }
  throw new BrainUnavailableError('chapter expert failed', last);
}

/** Answers only from one chapter; every claim must carry a quote that code finds on the cited page. */
export function createChapterExpert(
  deps: ExpertDeps,
  courseId: string,
  chapter: string,
): ChapterExpert {
  return {
    courseId,
    chapter,
    async answer(question: string): Promise<ExpertAnswer> {
      return withAgentState(deps.emit, expertAgent(chapter), async () => {
        const ctx = await deps.contexts.get(courseId, chapter);
        if (ctx.pages.length === 0) {
          return renderAnswer([], { courseId, chapter });
        }
        const out = await askModel(
          deps.llm,
          ctx.cache ? undefined : ctx.system,
          ctx.cache,
          question,
        );
        const claims: Claim[] = out.claims.slice(0, MAX_CLAIMS * 3);
        const { verified, struck } = verifyClaims(claims, ctx.pages);
        return renderAnswer(verified.slice(0, MAX_CLAIMS), {
          courseId,
          chapter,
          struck: struck.length + Math.max(0, verified.length - MAX_CLAIMS),
        });
      });
    },
  };
}
