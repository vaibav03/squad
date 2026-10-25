import type { Citation } from '@squad/core';
import type { Claim, ExpertAnswer } from '../experts/types';
import { NOT_IN_MATERIALS } from '../experts/types';
import type { Page } from '../ingest/types';

export function claimToCitation(c: Claim, courseId: string, chapter: string): Citation {
  return { courseId, chapter, file: c.file, page: c.page, quote: c.quote };
}

/** Builds the answer from VERIFIED claims only. No verified claims => the refusal. */
export function renderAnswer(
  verified: Claim[],
  ctx: { courseId: string; chapter: string; chapters?: string[]; struck?: number },
): ExpertAnswer {
  const struck = ctx.struck ?? 0;
  const chapters = ctx.chapters ?? [ctx.chapter];
  if (verified.length === 0)
    return { text: NOT_IN_MATERIALS, citations: [], grounded: false, chapters, struck };
  const text = verified.map((c) => `${c.text.trim()} (${c.file} p.${c.page})`).join(' ');
  return {
    text,
    citations: verified.map((c) => claimToCitation(c, ctx.courseId, ctx.chapter)),
    grounded: true,
    chapters,
    struck,
  };
}

export type { Page };
