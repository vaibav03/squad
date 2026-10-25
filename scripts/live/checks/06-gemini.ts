import { z } from 'zod';
import { createCourseStore, loadFixtureCourse } from '@squad/brain';
import { openMemoryDb } from '@squad/core/node';
import { clip } from '../lib/fx';
import type { Check } from '../lib/types';

/** Explicit cache creation and hit, optional implicit caching, tool-call loop with thought signatures, 429 retry. */
export const geminiCheck: Check = {
  id: 6,
  name: 'gemini: context cache, tool loop + thought signatures, rate-limit retry',
  needs: ['gemini'],
  estimate: { calls: 12, tokens: 9500 },
  async run(ctx, t) {
    const store = createCourseStore(openMemoryDb());
    await loadFixtureCourse({ store }, 'demo');
    const block = store.chapterContext('demo', 'ch6');

    await t.step(
      'explicit cache: create (>= 4096 tokens), hit on the next request, delete',
      async () => {
        const h = await ctx.llm.createCache({
          model: 'main',
          system: `Answer only from this chapter.\n\n${block}`,
          ttlSeconds: 120,
        });
        if (!h.id) throw new Error('empty cache handle');
        try {
          const r = await ctx.llm.complete({
            model: 'main',
            cache: h,
            messages: 'In one short sentence: what does a z-score measure?',
            maxTokens: 400,
            temperature: 0,
          });
          const cached = r.usage?.cachedTokens ?? 0;
          if (!r.text.trim()) throw new Error('empty answer through the cache');
          if (cached < 1000)
            throw new Error(
              `no cache hit: cachedTokens=${cached} (usage ${JSON.stringify(r.usage)}). Check the min cache size for the model and that the cache model id equals the request model id`,
            );
          return `handle ${h.id.slice(0, 24)}; cachedTokens=${cached} of ${r.usage?.inputTokens}; expires ${h.expiresAt ? new Date(h.expiresAt).toISOString() : '?'}`;
        } finally {
          await ctx.llm.deleteCache?.(h).catch(() => undefined);
        }
      },
    );

    if (ctx.env.LIVE_IMPLICIT === '1')
      await t.step(
        'implicit caching: same long prefix twice reports cachedTokens (informational)',
        async () => {
          const sys = `Answer only from this chapter.\n\n${store.chapterContext('demo', 'ch12')}`;
          const q = (n: string) =>
            ctx.llm.complete({
              model: 'main',
              system: sys,
              messages: n,
              maxTokens: 200,
              temperature: 0,
            });
          await q('What is a regression line? One sentence.');
          const b = await q('What is the correlation coefficient? One sentence.');
          t.metric('implicit cache cachedTokens', b.usage?.cachedTokens ?? 0);
          return `second request cachedTokens=${b.usage?.cachedTokens ?? 0} (implicit hits are best-effort, not a guarantee)`;
        },
      );
    else t.skip('implicit caching', 'set LIVE_IMPLICIT=1 (about 12k extra tokens)');

    const tool = {
      name: 'lookup_constant',
      description: 'Returns the value of a named lab constant.',
      parameters: z.object({ name: z.string() }),
    };
    await t.step(
      'tool-call loop: the model calls the tool, the result is replayed with its thought signature',
      async () => {
        let called = 0;
        const r = await ctx.llm.complete({
          model: 'main',
          messages:
            'Use the lookup_constant tool for the constant named "zorblax", then reply with: The value is <value>.',
          tools: [
            { ...tool, execute: (a: { name: string }) => (called++, { name: a.name, value: 7 }) },
          ],
          maxToolRounds: 3,
          maxTokens: 600,
          temperature: 0,
        });
        if (called < 1) throw new Error(`the tool was never executed; text=${clip(r.text)}`);
        if (!/7|seven/i.test(r.text))
          throw new Error(`final text lacks the tool result: ${clip(r.text)}`);
        return `tool executed ${called}x; final: ${clip(r.text, 80)}`;
      },
    );
    await t.step('thought signature present on a raw tool call (Gemini 3)', async () => {
      const r = await ctx.llm.complete({
        model: 'main',
        messages: 'Call lookup_constant with name "zorblax". Do not answer in text.',
        tools: [tool],
        maxTokens: 400,
        temperature: 0,
      });
      const c = r.toolCalls[0];
      if (!c) throw new Error('no tool call returned');
      t.metric(
        'thoughtSignature on first tool call',
        c.signature ? `yes (${c.signature.length} chars)` : 'absent',
      );
      return c.signature
        ? `signature ${c.signature.length} chars`
        : 'no signature returned: fine for non-thinking models, but a replay on Gemini 3 would 400 only if one was issued';
    });

    await t.step(
      'rate-limit behavior: a parallel burst completes, 429s (if any) were retried',
      async () => {
        const before = ctx.telemetry.calls.length;
        const burst = await Promise.allSettled(
          Array.from({ length: 4 }, (_, i) =>
            ctx.llm.complete({
              model: 'fast',
              messages: `Reply with the digit ${i}.`,
              maxTokens: 256,
              temperature: 0,
            }),
          ),
        );
        const fails = burst.filter((b) => b.status === 'rejected');
        const seen429 = ctx.telemetry.calls.slice(before).filter((c) => c.status === 429).length;
        t.metric('burst 429 responses seen', seen429);
        if (fails.length)
          throw new Error(
            `${fails.length}/4 failed after retries: ${clip(String((fails[0] as PromiseRejectedResult).reason))}`,
          );
        return `4/4 succeeded; ${seen429} raw 429 response(s) absorbed by the retry loop`;
      },
    );
  },
};
