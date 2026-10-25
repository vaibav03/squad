import path from 'node:path';
import { openMemoryDb } from '@squad/core/node';
import {
  SPARSE_PAGE_CHARS,
  StepDiffEngine,
  extractPages,
  extractSteps,
  normalizeText,
  quoteOnPage,
} from '@squad/brain';
import { FIXTURES, clip } from '../lib/fx';
import type { Check } from '../lib/types';

const VERDICT =
  /\b(wrong|incorrect|mistake|error|you are right|you're right|is right|is correct|is wrong|better|should be|the answer is|correct answer)\b/i;

/** Step Diff on two synthetic handwritten solutions (first divergence, never a verdict); scanned-PDF ingest through vision. */
export const visionCheck: Check = {
  id: 3,
  name: 'vision: step diff on handwritten images, scanned PDF page ingest',
  needs: ['gemini'],
  estimate: { calls: 5, tokens: 5500 },
  async run(ctx, t) {
    const a = { path: path.join(FIXTURES, 'stepdiff-a.png'), mime: 'image/png' };
    const b = { path: path.join(FIXTURES, 'stepdiff-b.png'), mime: 'image/png' };
    await t.step('fixtures exist (pnpm live:images regenerates them)', async () => {
      const fs = await import('node:fs');
      for (const f of [a.path, b.path, path.join(FIXTURES, 'scanned-page.pdf')])
        if (!fs.existsSync(f)) throw new Error(`missing ${f}; run: pnpm live:images`);
      return 'present';
    });

    await t.step('transcribes the correct solution (4 steps, legible)', async () => {
      const r = await extractSteps(ctx.llm, a);
      if (!r.legible) throw new Error('model said illegible for a clean synthetic image');
      if (r.steps.length < 3 || r.steps.length > 6)
        throw new Error(
          `expected about 4 steps, got ${r.steps.length}: ${r.steps.map((s) => s.text).join(' | ')}`,
        );
      const flat = normalizeText(r.steps.map((s) => s.text).join(' '));
      if (!/\b2x\b/.test(flat) || !/\b14\b/.test(flat))
        throw new Error(`transcription misses the content: ${clip(flat)}`);
      return `steps: ${r.steps.map((s) => s.text).join(' | ')}`;
    });

    await t.step('two photos -> first divergence at step 2, no verdict', async () => {
      const db = openMemoryDb();
      db.exec("INSERT OR IGNORE INTO students(id, name) VALUES ('s_a','Ana'),('s_b','Ben')");
      const eng = new StepDiffEngine({ db, llm: ctx.llm, emit: () => undefined });
      const id = eng.open('chat1', 'demo', 'full');
      const r1 = await eng.submitPhoto(id, 's_a', a);
      if (r1.status !== 'waiting') throw new Error(`first submit: ${r1.status}`);
      const r2 = await eng.submitPhoto(id, 's_b', b);
      if (r2.status !== 'done')
        throw new Error(`second submit: ${r2.status} ${'message' in r2 ? r2.message : ''}`);
      const d = r2.divergence;
      if (d.split !== 2)
        throw new Error(
          `first divergence at step ${d.split}, expected 2 (14 - 6 vs 14 + 6). matchedThrough=${d.matchedThrough}; A=${clip(JSON.stringify(d.stepA), 200)} B=${clip(JSON.stringify(d.stepB), 200)}`,
        );
      const prose = r2.message
        .split('\n')
        .filter((l) => !/ wrote: /.test(l) && !l.startsWith('Matching:'))
        .join(' ');
      if (VERDICT.test(prose))
        throw new Error(`the group message sounds like a verdict: ${clip(prose)}`);
      if (/\bx\s*=\s*4\b/.test(prose))
        throw new Error('the group message states the correct final answer');
      return `split=${d.split}, concept=${d.concept ?? 'none'}; message: ${clip(r2.message.replace(/\n/g, ' / '), 200)}`;
    });

    const pdf = path.join(FIXTURES, 'scanned-page.pdf');
    await t.step(
      'scanned PDF page: no text layer, vision fallback recovers the sentences',
      async () => {
        const bare = await extractPages(pdf);
        const bareLen = (bare[0] ?? '').length;
        if (bareLen >= SPARSE_PAGE_CHARS)
          throw new Error(
            `fixture has a text layer (${bareLen} chars); the vision path would not run`,
          );
        const pages = await extractPages(pdf, { llm: ctx.llm });
        const text = normalizeText(pages[0] ?? '');
        if (!text.includes('one quarter') || !text.includes('independent'))
          throw new Error(`vision text misses the page content: raw=${JSON.stringify(pages[0] ?? '')}`);
        // end-to-end for the citation checker: a punctuated, mixed-case quote of the OCR'd page verifies
        const quote = 'Two independent flips both land heads with probability one quarter.';
        if (!quoteOnPage(quote, pages[0] ?? ''))
          throw new Error(`a verbatim quote of the scanned page fails quote verification: ${JSON.stringify(pages[0])}`);
        return `text layer ${bareLen} chars -> vision ${text.length} chars: ${clip(text, 100)}`;
      },
    );
  },
};
