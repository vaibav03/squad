import type { CacheHandle, Llm } from '@squad/core';
import type { CourseStore } from '../ingest/types';
import type { ChapterContext, ContextProvider } from './types';
import { loadPrompt } from './prompts';

/**
 * Explicit caching on gemini-3.8-flash needs >= 4,096 input tokens (ai.google.dev context caching
 * table). At ~4 chars/token that is ~16k chars; below this we skip the cache call (it would 400) and
 * send a plain prompt.
 */
export const MIN_CACHE_CHARS = 16_384;
export const CACHE_TTL_SECONDS = 1800;

export interface ContextOptions {
  now?: () => number;
  ttlSeconds?: number;
  minCacheChars?: number;
}

/**
 * One ChapterContext per (course, chapter): the system prompt plus the chapter block FIRST and
 * byte-identical, so an explicit cache or implicit prefix caching can hit. Never throws.
 */
export function createContextProvider(
  store: CourseStore,
  llm: Llm,
  opts: ContextOptions = {},
): ContextProvider & { invalidate(courseId: string, chapter: string): void } {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlSeconds ?? CACHE_TTL_SECONDS;
  const minChars = opts.minCacheChars ?? MIN_CACHE_CHARS;
  const base = loadPrompt(import.meta.url, 'expert.system.md');
  const memo = new Map<string, Promise<ChapterContext>>();
  const handles = new Map<string, CacheHandle | undefined>();
  const key = (c: string, ch: string) => `${c}\u0000${ch}`;

  async function build(courseId: string, chapter: string): Promise<ChapterContext> {
    const pages = store.getPages(courseId, chapter);
    const block = store.chapterContext(courseId, chapter);
    const system = `${base}\n\n${block}`;
    let cache: CacheHandle | undefined;
    if (block.length >= minChars) {
      try {
        cache = await llm.createCache({ model: 'main', system, ttlSeconds: ttl });
      } catch {
        cache = undefined; // quota/model rejected: fall back to a plain prompt
      }
    }
    handles.set(key(courseId, chapter), cache);
    return { courseId, chapter, system, block, cache, pages };
  }

  return {
    async get(courseId, chapter) {
      const k = key(courseId, chapter);
      let p = memo.get(k);
      if (p) {
        const ctx = await p;
        const exp = ctx.cache?.expiresAt;
        if (exp === undefined || exp - 30_000 > now()) return ctx;
        memo.delete(k); // expired cache: rebuild
      }
      p = build(courseId, chapter);
      memo.set(k, p);
      return p;
    },
    invalidate(courseId, chapter) {
      memo.delete(key(courseId, chapter));
    },
  };
}
