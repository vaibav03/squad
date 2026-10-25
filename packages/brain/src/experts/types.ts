import type { CacheHandle, Citation, Db, Llm, StudentId, VillageEvent } from '@squad/core';
import type { CourseStore } from '../ingest/types';

/** Every event goes through this. Default: `postEvent` from @squad/core. Tests pass a collector. */
export type Emit = (e: VillageEvent) => void | Promise<unknown>;

export interface BrainDeps {
  llm: Llm;
  db: Db;
  /** Defaults to core `postEvent` (never throws on a missing hub). */
  emit?: Emit;
  now?: () => number;
}

/** What an expert returns. grounded=false means the text is exactly the "not in the materials" reply. */
export interface ExpertAnswer {
  text: string; // user-facing, with verified "(file p.N)" suffixes already rendered
  citations: Citation[]; // verified only; each has a `quote` that is on the cited page
  grounded: boolean;
  claims: Claim[]; // the verified claims the text was assembled from (empty when ungrounded)
  chapters: string[]; // chapter ids consulted
  struck: number; // claims dropped by the checker (for logs/evals)
}

export const NOT_IN_MATERIALS = 'Not in the materials. Ask the TA.';

/** One claim the expert model asserts, to be verified in code. */
export interface Claim {
  text: string;
  file: string;
  page: number;
  quote: string;
}

/** Chapter context shared by experts and captions: cached once per chapter. */
export interface ChapterContext {
  courseId: string;
  chapter: string;
  system: string; // stable system prompt (grounding rules + chapter block), byte-identical per chapter
  block: string; // chapter text with [file p.N] markers
  cache?: CacheHandle; // from Llm.createCache; absent for tiny chapters or if caching failed
  pages: import('../ingest/types').Page[];
}

export interface ContextProvider {
  get(courseId: string, chapter: string): Promise<ChapterContext>;
}

export interface ChapterExpert {
  readonly courseId: string;
  readonly chapter: string;
  /** Answers only from this chapter. Emits agent.state studying -> idle for `expert:<chapter>`. */
  answer(question: string): Promise<ExpertAnswer>;
}

export interface DeanRoute {
  chapters: string[]; // 0 (none), 1 or 2 chapter ids
  via: 'llm' | 'bm25';
}

export interface Dean {
  route(courseId: string, question: string): Promise<DeanRoute>;
}

export interface CaptionLine {
  seq: number;
  text: string;
  cite?: Citation; // verified; present whenever the sentence states a fact
}

export interface CaptionRun {
  callId: string;
  courseId: string;
  chapter: string;
  question: string;
  student?: StudentId;
}

export interface CaptionPipeline {
  /**
   * Answer `question` from the chapter, split into sentences, run the citation gate, emit one
   * `call.caption` per surviving sentence (via Emit), store transcript rows (`call_transcripts`),
   * and return the lines (the voice layer speaks these). Does NOT emit call.start/call.end (hub).
   */
  run(r: CaptionRun, onLine?: (l: CaptionLine) => void): Promise<CaptionLine[]>;
  transcript(callId: string): CaptionLine[];
}

export interface Brain {
  readonly store: CourseStore;
  ingestPdf(
    courseId: string,
    path: string,
    opts?: { title?: string; chapter?: string },
  ): Promise<number>;
  /** Dean -> expert(s) -> (merge) -> verified answer. */
  ask(courseId: string, question: string): Promise<ExpertAnswer>;
  expert(courseId: string, chapter: string): ChapterExpert;
  dean: Dean;
  captions: CaptionPipeline;
  emit: Emit;
}

export type { Citation, Llm, Db };
