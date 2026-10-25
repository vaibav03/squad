import {
  FakeLlm,
  type CacheHandle,
  type LlmCacheRequest,
  type LlmJsonRequest,
  type LlmRequest,
  normalizeMessages,
  textOf,
} from '@squad/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_DIR } from '../src';

export interface Golden {
  id: string;
  question: string;
  chapter: string;
  file: string;
  page: number;
  quote: string;
  keywords: string[];
}
export interface GoldenSet {
  answerable: Golden[];
  unanswerable: { id: string; question: string }[];
}

export const loadGolden = (): GoldenSet =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, 'golden.json'), 'utf8')) as GoldenSet;

export type Mode =
  | 'honest' // cites the true quote on the true page; none for unanswerable questions
  | 'wrong-page' // true quote, but a page that does not contain it
  | 'fabricated' // invented quote on the right page, for every question (also unanswerable ones)
  | 'cross-chapter'; // a real quote from ANOTHER chapter, cited against this chapter

/**
 * A scripted stand-in for the model that behaves like a good (or a planted-bad) expert on the real
 * fixture. It tests the pipeline's grounding logic (routing, caches, the citation gate), not model
 * quality; the flagged real-key script measures the latter.
 */
export class OracleLlm extends FakeLlm {
  private systems = new Map<string, string>();
  constructor(
    private golden: GoldenSet,
    private mode: Mode,
  ) {
    super({ fallback: (req) => this.respond(req) });
  }

  override async createCache(req: LlmCacheRequest): Promise<CacheHandle> {
    const h = await super.createCache(req);
    this.systems.set(h.id, req.system ?? '');
    return h;
  }

  private respond(req: LlmRequest | LlmJsonRequest<unknown>): Record<string, unknown> | string {
    const first = normalizeMessages(req.messages)[0]!;
    const content = textOf(first.content);
    const system = req.system ?? (req.cache ? (this.systems.get(req.cache.id) ?? '') : '');
    if ((req.system ?? '').includes('You are the Dean')) {
      const question = content.split('Question: ').pop()!.trim();
      const g = this.golden.answerable.find((a) => a.question === question);
      return { chapters: g ? [g.chapter] : [] };
    }
    const m = /(?:Student question|Student said on the call): ([^\n]*)/.exec(content);
    if (!m) return { summary: 'summary of the chapter for routing' };
    const question = m[1]!.trim();
    const g = this.golden.answerable.find((a) => a.question === question);
    const chapterHere = /\[(ch\d+-[a-z-]+\.pdf) p\.1\]/.exec(system)?.[1];
    const isCaption = content.includes('Student said on the call');
    const claim = (file: string, page: number, quote: string, text: string) => ({
      text,
      file,
      page,
      quote,
    });
    let c: ReturnType<typeof claim> | undefined;
    if (this.mode === 'fabricated') {
      c = claim(
        chapterHere ?? 'x.pdf',
        1,
        'This sentence was invented by the model and is nowhere in the chapter.',
        'An invented fact.',
      );
    } else if (g && this.mode === 'honest')
      c = claim(g.file, g.page, g.quote, `Per the book: ${g.keywords.join(', ')}.`);
    else if (g && this.mode === 'wrong-page') {
      const wrong = g.page === 1 ? 3 : 1;
      c = claim(g.file, wrong, g.quote, 'A claim with a planted wrong page.');
    } else if (g && this.mode === 'cross-chapter') {
      const other = this.golden.answerable.find((a) => a.chapter !== g.chapter)!;
      c = claim(g.file, g.page, other.quote, 'A claim quoting another chapter.');
    }
    if (isCaption)
      return {
        sentences: c
          ? [{ text: c.text, factual: true, file: c.file, page: c.page, quote: c.quote }]
          : [],
      };
    return { answer: '', claims: c ? [c] : [] };
  }
}
