/**
 * REAL-KEY EVAL (flagged, tiny budget). Runs a handful of golden questions against real Gemini.
 *   pnpm --filter @squad/brain eval:real        (needs BRAIN_REAL_EVAL=1 and GEMINI_API_KEY in .env)
 * Budget: BRAIN_EVAL_MAX_CALLS (default 14) hard-caps model calls; the script stops when it is hit.
 * It never runs in `pnpm test` or CI. Nothing here prints the key.
 */
import { openMemoryDb, GeminiLlm } from '@squad/core/node';
import type { Llm } from '@squad/core';
import { NOT_IN_MATERIALS, createBrain, loadFixtureCourse, quoteOnPage } from '../src';
import { loadGolden } from './oracle';

if (process.env.BRAIN_REAL_EVAL !== '1') {
  console.log('Skipped: set BRAIN_REAL_EVAL=1 (and GEMINI_API_KEY) to run the real-key eval.');
  process.exit(0);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set (put it in .env and run with --env-file=.env).');
  process.exit(2);
}

const MAX_CALLS = Number(process.env.BRAIN_EVAL_MAX_CALLS ?? 14);
let calls = 0;
let inTok = 0;
let outTok = 0;
let cached = 0;

class BudgetExceeded extends Error {}
function budgeted(inner: Llm): Llm {
  const gate = () => {
    if (++calls > MAX_CALLS) throw new BudgetExceeded(`call budget ${MAX_CALLS} exhausted`);
  };
  return {
    async complete(r) {
      gate();
      const res = await inner.complete(r);
      inTok += res.usage?.inputTokens ?? 0;
      outTok += res.usage?.outputTokens ?? 0;
      cached += res.usage?.cachedTokens ?? 0;
      return res;
    },
    async json(r) {
      gate();
      return inner.json(r);
    },
    createCache: (r) => inner.createCache(r),
    deleteCache: (h) => inner.deleteCache?.(h) ?? Promise.resolve(),
  };
}

const golden = loadGolden();
const llm = budgeted(new GeminiLlm());
const brain = createBrain({ llm, db: openMemoryDb(), emit: () => {} });
await loadFixtureCourse({ store: brain.store });

const picks = [golden.answerable[1]!, golden.answerable[4]!, golden.answerable[13]!];
const refuse = [golden.unanswerable[0]!, golden.unanswerable[4]!];
let pass = 0;
let total = 0;
const report: string[] = [];
try {
  for (const g of picks) {
    total++;
    const a = await brain.ask('demo', g.question);
    const ok =
      a.grounded &&
      a.citations.every((c) =>
        quoteOnPage(c.quote!, brain.store.getPage('demo', c.file, c.page!)?.text ?? ''),
      ) &&
      a.citations.some((c) => c.file === g.file);
    if (ok) pass++;
    report.push(`${ok ? 'PASS' : 'FAIL'} answerable ${g.id}: ${a.text.slice(0, 120)}`);
  }
  for (const u of refuse) {
    total++;
    const a = await brain.ask('demo', u.question);
    const ok = !a.grounded && a.text === NOT_IN_MATERIALS;
    if (ok) pass++;
    report.push(`${ok ? 'PASS' : 'FAIL'} refuse ${u.id}: ${a.text.slice(0, 120)}`);
  }
} catch (e) {
  report.push(`STOPPED: ${(e as Error).message}`);
}
console.log(report.join('\n'));
console.log(
  `${pass}/${total} passed; model calls=${calls}/${MAX_CALLS}; tokens in=${inTok} out=${outTok} cached=${cached}`,
);
process.exit(pass === total ? 0 : 1);
