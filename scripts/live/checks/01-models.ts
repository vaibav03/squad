import type { z } from 'zod';
import { QuestionsSchema } from '@squad/brain';
import { ExpertOutputSchema } from '../../../packages/brain/src/experts/expert';
import { ScriptSchema } from '../../../packages/media/src/podcast/script';
import type { Check } from '../lib/types';

/** Model ids exist, the three tiers answer, and the product's own zod schemas survive responseJsonSchema. */
export const modelsCheck: Check = {
  id: 1,
  name: 'model ids, tiers, structured JSON per skill family',
  needs: ['gemini'],
  estimate: { calls: 8, tokens: 4500 },
  async run(ctx, t) {
    const ids = [...new Set(Object.values(ctx.models))];
    if (ctx.client) {
      await t.step('model ids exist (models.list)', async () => {
        const names = new Set<string>();
        const pager = await ctx.client!.models.list({ config: { pageSize: 200 } });
        for await (const m of pager as AsyncIterable<{ name?: string }>)
          if (m.name) names.add(m.name.replace(/^models\//, ''));
        const missing = ids.filter((id) => !names.has(id));
        if (missing.length)
          throw new Error(
            `not in the models list: ${missing.join(', ')}. Fix GEMINI_MODEL_FAST/MAIN/CHAIR in .env (or the defaults in packages/core/src/llm/gemini.ts:17). Closest listed: ${[
              ...names,
            ]
              .filter((n) => n.startsWith('gemini-'))
              .slice(0, 12)
              .join(', ')}`,
          );
        return `${ids.length} configured id(s) all listed (${names.size} models visible)`;
      });
    } else t.skip('model ids exist (models.list)', 'injected Llm: no raw client');

    const seen = new Map<string, string>();
    for (const tier of ['fast', 'main', 'chair'] as const) {
      const id = ctx.models[tier];
      if (seen.has(id)) {
        t.pass(
          `tier ${tier} answers`,
          `same model id as tier ${seen.get(id)} (${id}); not called again`,
        );
        continue;
      }
      seen.set(id, tier);
      await t.step(`tier ${tier} answers (${id})`, async () => {
        const r = await ctx.llm.complete({
          model: tier,
          messages: 'Reply with the single word OK.',
          maxTokens: 256,
          temperature: 0,
        });
        if (!r.text.trim())
          throw new Error(
            'empty text (a thinking model may have spent maxTokens; check finishReason)',
          );
        return `text=${JSON.stringify(r.text.trim().slice(0, 40))} usage=${JSON.stringify(r.usage ?? {})}`;
      });
    }

    const json = async <T>(
      name: string,
      schema: z.ZodType<T>,
      prompt: string,
      ok: (v: T) => string | undefined,
    ) =>
      t.step(`structured JSON: ${name}`, async () => {
        const v = await ctx.llm.json({
          model: 'main',
          messages: prompt,
          schema,
          temperature: 0,
          maxTokens: 1500,
        });
        const bad = ok(v);
        if (bad) throw new Error(bad);
        return `parsed with the product schema; ${JSON.stringify(v).length} chars`;
      });

    await json(
      'quiz (QuestionsSchema)',
      QuestionsSchema,
      'Material: [a.pdf p.1] A fair coin lands heads with probability one half. Write 1 multiple-choice question (kind "choice", 3 choices, 0-based key) from it. Return {"questions":[...]}.',
      (v) => (v.questions.length < 1 ? 'no questions' : undefined),
    );
    await json(
      'expert answer (ExpertOutputSchema)',
      ExpertOutputSchema,
      'Material: [a.pdf p.1] A fair coin lands heads with probability one half. Question: what is the probability of heads? Return {"answer": "", "claims": [{"text","file","page","quote"}]} with a verbatim quote.',
      (v) => (v.claims.length < 1 ? 'no claims' : undefined),
    );
    await json(
      'podcast script (ScriptSchema)',
      ScriptSchema,
      'Write a 4-turn podcast dialogue between speakers "cubbie" and "rival" about coin flips. Each turn: {"speaker","text","kind":"fact"|"banter"}. Return {"turns":[...]}.',
      (v) => (v.turns.length < 4 ? `only ${v.turns.length} turns` : undefined),
    );
    t.metric(
      'families proven in other checks',
      'dean routing + merge (2), stepdiff steps + equivalence (3), quiz grade + quizkey council (4), council opinion/ranking/verdict (5), feynman (5)',
    );
  },
};
