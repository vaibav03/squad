import { CitationSchema, agentId, type Citation, type Db } from '@squad/core';
import type { Llm } from '@squad/core';
import { z } from 'zod';
import { withAgentState } from '../experts/emit';
import { loadPrompt } from '../experts/prompts';
import type {
  CaptionLine,
  CaptionPipeline,
  CaptionRun,
  ContextProvider,
  Emit,
} from '../experts/types';
import { BRAIN_SCHEMA } from '../ingest/store';
import type { CourseStore } from '../ingest/types';
import { CaptionUnavailableError } from './errors';
import { gateSentences } from './sentences';

export * from './sentences';
export * from './errors';

export const NO_SUPPORT_CAPTION = "That isn't in the materials for this chapter.";

const OutputSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string(),
        factual: z.boolean(),
        file: z.string().optional(),
        page: z.number().optional(),
        quote: z.string().optional(),
      }),
    )
    .max(12),
});

export interface CaptionDeps {
  store: CourseStore;
  contexts: ContextProvider;
  llm: Llm;
  emit: Emit;
  db: Db;
  now?: () => number;
}

export function createCaptionPipeline(deps: CaptionDeps): CaptionPipeline {
  const base = loadPrompt(import.meta.url, 'caption.task.md');
  deps.db.exec(BRAIN_SCHEMA);
  const insert = deps.db.prepare(
    'INSERT OR REPLACE INTO call_transcripts(callId, agent, seq, text, cite) VALUES(?,?,?,?,?)',
  );
  const select = deps.db.prepare(
    'SELECT seq, text, cite FROM call_transcripts WHERE callId=? ORDER BY seq',
  );
  const clear = deps.db.prepare('DELETE FROM call_transcripts WHERE callId=?');

  async function generate(ctx: Awaited<ReturnType<ContextProvider['get']>>, question: string) {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await deps.llm.json({
          model: 'main',
          system: ctx.cache ? undefined : ctx.system,
          cache: ctx.cache,
          messages: `${base}\n\nStudent said on the call: ${question}\n\nRespond as JSON.`,
          schema: OutputSchema,
          temperature: 0,
        });
      } catch (e) {
        last = e;
      }
    }
    throw new CaptionUnavailableError('caption generation failed', last);
  }

  return {
    async run(r: CaptionRun, onLine?: (l: CaptionLine) => void): Promise<CaptionLine[]> {
      const agent = agentId.expert(r.chapter);
      return withAgentState(
        deps.emit,
        agent,
        async () => {
          const ctx = await deps.contexts.get(r.courseId, r.chapter);
          const out = await generate(ctx, r.question);
          const { lines: gated } = gateSentences(out.sentences, ctx.pages, {
            courseId: r.courseId,
            chapter: r.chapter,
          });
          const hasFact = gated.some((g) => g.cite);
          const lines: CaptionLine[] = (hasFact ? gated : [{ text: NO_SUPPORT_CAPTION }]).map(
            (g, seq) => ({ seq, text: g.text, ...(g.cite ? { cite: g.cite } : {}) }),
          );
          clear.run(r.callId);
          for (const l of lines) {
            insert.run(r.callId, agent, l.seq, l.text, l.cite ? JSON.stringify(l.cite) : null);
            try {
              await deps.emit({
                t: 'call.caption',
                agent,
                callId: r.callId,
                ...(r.student ? { student: r.student } : {}),
                text: l.text,
                ...(l.cite ? { cite: l.cite } : {}),
              });
            } catch {
              /* a lost event must not stop the call */
            }
            onLine?.(l);
          }
          return lines;
        },
        'in_call',
      );
    },
    transcript(callId: string): CaptionLine[] {
      return (select.all(callId) as { seq: number; text: string; cite: string | null }[]).map(
        (row) => ({
          seq: row.seq,
          text: row.text,
          ...(row.cite ? { cite: CitationSchema.parse(JSON.parse(row.cite)) as Citation } : {}),
        }),
      );
    },
  };
}
