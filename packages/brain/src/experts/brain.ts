import { z } from 'zod';
import type { Citation } from '@squad/core';
import { createDean } from '../dean';
import { claimToCitation } from '../citations';
import { answerFromContext } from '../context/answer';
import type { ContextViewer } from '../context/types';
import type { CourseStore } from '../ingest/types';
import { BrainUnavailableError } from './errors';
import { createContextProvider } from './context';
import { defaultEmit } from './emit';
import { createChapterExpert } from './expert';
import {
  NOT_IN_MATERIALS,
  type Brain,
  type BrainDeps,
  type CaptionPipeline,
  type ChapterExpert,
  type ContextProvider,
  type Emit,
  type ExpertAnswer,
} from './types';
import type { Llm } from '@squad/core';

export interface CreateBrainDeps extends BrainDeps {
  store: CourseStore;
  /** Builds the call caption pipeline (captions/). Absent: `brain.captions` throws on use. */
  makeCaptions?: (d: {
    store: CourseStore;
    contexts: ContextProvider;
    emit: Emit;
    db: BrainDeps['db'];
    llm: Llm;
    now?: () => number;
  }) => CaptionPipeline;
  /** Wires ingest/ (injected to avoid a cycle). */
  ingest?: (
    courseId: string,
    path: string,
    opts?: { title?: string; chapter?: string },
  ) => Promise<number>;
}

const MergeSchema = z.object({ order: z.array(z.number().int()).max(8) });

/**
 * Merge two chapters' verified claims. The Llm only returns an ORDER of claim indexes (and drops
 * duplicates by omission); text and citations are assembled from the verified claims in code, so
 * the merge can never introduce an unverified statement.
 */
async function mergeAnswers(
  llm: Llm,
  question: string,
  a: ExpertAnswer,
  b: ExpertAnswer,
): Promise<ExpertAnswer> {
  const pool = [
    ...a.claims.map((c) => ({ c, chapter: a.chapters[0]! })),
    ...b.claims.map((c) => ({ c, chapter: b.chapters[0]! })),
  ];
  let order = pool.map((_, i) => i);
  try {
    const r = await llm.json({
      model: 'main',
      system:
        'You merge two expert answers. Given numbered verified claims, return JSON {"order": [indexes]}: the claims that best answer the question in reading order. Omit duplicates and irrelevant claims. Use only the given indexes.',
      messages: `Question: ${question}\n\nClaims:\n${pool.map((p, i) => `${i}: ${p.c.text}`).join('\n')}`,
      schema: MergeSchema,
      temperature: 0,
    });
    const picked = [...new Set(r.order)].filter((i) => i >= 0 && i < pool.length);
    if (picked.length > 0) order = picked;
  } catch {
    /* keep the natural order */
  }
  const chosen = order.map((i) => pool[i]!);
  const citations: Citation[] = chosen.map((p) =>
    claimToCitation(p.c, a.citations[0]?.courseId ?? b.citations[0]?.courseId ?? '', p.chapter),
  );
  return {
    text: chosen.map((p) => `${p.c.text.trim()} (${p.c.file} p.${p.c.page})`).join(' '),
    citations,
    grounded: true,
    claims: chosen.map((p) => p.c),
    chapters: [...new Set([...a.chapters, ...b.chapters])],
    struck: a.struck + b.struck,
  };
}

export function assembleBrain(deps: CreateBrainDeps): Brain {
  const emit = deps.emit ?? defaultEmit;
  const { llm, store, db } = deps;
  const contexts = createContextProvider(store, llm, { now: deps.now });
  const dean = createDean({ llm, store, emit });
  const experts = new Map<string, ChapterExpert>();
  const expert = (courseId: string, chapter: string): ChapterExpert => {
    const k = `${courseId}\u0000${chapter}`;
    let e = experts.get(k);
    if (!e) {
      e = createChapterExpert({ llm, store, contexts, emit }, courseId, chapter);
      experts.set(k, e);
    }
    return e;
  };
  let captions: CaptionPipeline | undefined;
  const brain: Brain = {
    store,
    emit,
    dean,
    expert,
    get captions(): CaptionPipeline {
      if (!captions) {
        if (!deps.makeCaptions) throw new Error('captions not configured');
        captions = deps.makeCaptions({ store, contexts, emit, db, llm, now: deps.now });
      }
      return captions;
    },
    async ingestPdf(courseId, path, opts) {
      if (!deps.ingest) throw new Error('ingest not configured');
      const n = await deps.ingest(courseId, path, opts);
      for (const c of store.listChapters(courseId)) contexts.invalidate(courseId, c.id);
      return n;
    },
    async ask(courseId, question, opts): Promise<ExpertAnswer> {
      const pdf = await askPdf(courseId, question);
      if (!deps.context || !opts?.viewer) return pdf;
      // Only chunks the viewer may read (own + squad-shared) are ever retrieved; claims are verified verbatim.
      const ctxCourse = opts.contextCourseId === undefined ? courseId : opts.contextCourseId;
      const hits = deps.context.search(question, opts.viewer as ContextViewer, {
        ...(ctxCourse ? { courseId: ctxCourse } : {}),
        limit: 4,
      });
      if (hits.length === 0) return pdf;
      const ctx = await answerFromContext(llm, question, hits);
      if (!ctx.grounded) return pdf;
      if (!pdf.grounded) return { ...ctx, struck: ctx.struck + pdf.struck };
      return {
        text: `${pdf.text} ${ctx.text}`,
        citations: [...pdf.citations, ...ctx.citations],
        grounded: true,
        claims: [...pdf.claims, ...ctx.claims],
        chapters: [...new Set([...pdf.chapters, ...ctx.chapters])],
        struck: pdf.struck + ctx.struck,
      };
    },
  };
  async function askPdf(courseId: string, question: string): Promise<ExpertAnswer> {
    {
      const route = await dean.route(courseId, question);
      if (route.chapters.length === 0)
        return {
          text: NOT_IN_MATERIALS,
          citations: [],
          grounded: false,
          claims: [],
          chapters: [],
          struck: 0,
        };
      if (route.chapters.length === 1) return expert(courseId, route.chapters[0]!).answer(question);
      const results = await Promise.allSettled(
        route.chapters.map((c) => expert(courseId, c).answer(question)),
      );
      const ok = results
        .filter((r): r is PromiseFulfilledResult<ExpertAnswer> => r.status === 'fulfilled')
        .map((r) => r.value);
      if (ok.length === 0)
        throw new BrainUnavailableError(
          'all experts failed',
          (results[0] as PromiseRejectedResult).reason,
        );
      const grounded = ok.filter((r) => r.grounded);
      if (grounded.length === 0) return ok[0]!;
      if (grounded.length === 1) return grounded[0]!;
      return mergeAnswers(llm, question, grounded[0]!, grounded[1]!);
    }
  }
  return brain;
}
