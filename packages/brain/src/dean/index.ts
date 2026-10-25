import { z } from 'zod';
import type { Llm } from '@squad/core';
import { withAgentState } from '../experts/emit';
import { loadPrompt } from '../experts/prompts';
import type { Dean, DeanRoute, Emit } from '../experts/types';
import type { CourseStore } from '../ingest/types';
import { BM25_MIN_SCORE, bm25Chapters } from './bm25';

export * from './bm25';

const RouteSchema = z.object({ chapters: z.array(z.string()).max(4) });

export interface DeanDeps {
  llm: Llm;
  store: CourseStore;
  emit: Emit;
}

export function createDean(deps: DeanDeps): Dean {
  const system = loadPrompt(import.meta.url, 'dean.system.md');
  return {
    async route(courseId, question): Promise<DeanRoute> {
      return withAgentState(deps.emit, 'dean', async () => {
        const chapters = deps.store.listChapters(courseId);
        if (chapters.length === 0) return { chapters: [], via: 'bm25' };
        const valid = new Set(chapters.map((c) => c.id));
        try {
          const list = chapters
            .map(
              (c) =>
                `- id: ${c.id}\n  title: ${c.title}\n  summary: ${c.summary.replace(/\n/g, ' / ')}`,
            )
            .join('\n');
          const r = await deps.llm.json({
            model: 'fast',
            system,
            messages: `Chapters:\n${list}\n\nQuestion: ${question}`,
            schema: RouteSchema,
            temperature: 0,
          });
          const picked = [...new Set(r.chapters.filter((id) => valid.has(id)))].slice(0, 2);
          // The model said "none" on purpose, or named only ids that do not exist.
          return { chapters: picked, via: 'llm' };
        } catch {
          const hits = bm25Chapters(deps.store.getPages(courseId), question);
          const top = hits[0];
          if (!top || top.score < BM25_MIN_SCORE) return { chapters: [], via: 'bm25' };
          const second = hits[1];
          const picks = [top.chapter];
          if (second && second.score >= top.score * 0.85) picks.push(second.chapter);
          return { chapters: picks, via: 'bm25' };
        }
      });
    },
  };
}
