/**
 * Real-key smoke script for the quiz half. Costs real (tiny) money: guarded by SQUAD_LIVE=1 and a
 * hard call budget. Run from the repo root:
 *   SQUAD_LIVE=1 pnpm --dir packages/brain exec tsx src/quiz/realkey.script.ts
 * It generates one question from a 3-line chapter, verifies the key with council:quizkey (3 blind
 * solves), answers it, and prints the event kinds. Never prints keys.
 */
import { loadConfig, openMemoryDb, GeminiLlm } from '@squad/core/node';
import type { Llm, LlmJsonRequest, LlmRequest, VillageEvent } from '@squad/core';
import { QuizEngine, createMasteryStore, createQuizKeyVerifier } from './index';

const MAX_CALLS = 14;
const MAX_TOKENS = 600;
const CHAPTER =
  '[demo.pdf p.1] Mean squared error (MSE) averages the squared differences between predictions and targets.\n[demo.pdf p.2] The gradient of MSE has a factor of 2 from differentiating the square.';

function budgeted(inner: Llm): Llm & { used: () => number } {
  let n = 0;
  const guard = () => {
    if (++n > MAX_CALLS) throw new Error(`budget exceeded: more than ${MAX_CALLS} LLM calls`);
  };
  return {
    used: () => n,
    complete: (r: LlmRequest) => (guard(), inner.complete({ ...r, maxTokens: MAX_TOKENS })),
    json: <T>(r: LlmJsonRequest<T>) => (guard(), inner.json({ ...r, maxTokens: MAX_TOKENS })),
    createCache: (r) => inner.createCache(r),
  };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.live) {
    console.log('SQUAD_LIVE is not 1: refusing to spend. Set SQUAD_LIVE=1 to run.');
    return;
  }
  if (!cfg.geminiApiKey) {
    console.log('GEMINI_API_KEY is missing from .env: nothing to run.');
    return;
  }
  const llm = budgeted(new GeminiLlm({ apiKey: cfg.geminiApiKey, models: cfg.geminiModels }));
  const events: VillageEvent[] = [];
  const emit = (e: VillageEvent) => void events.push(e);
  const db = openMemoryDb();
  const engine = new QuizEngine({
    db,
    llm,
    emit,
    mastery: createMasteryStore({ db, emit }),
    chapters: { chapterContext: async () => CHAPTER },
    verifier: createQuizKeyVerifier({ llm, emit }),
    questionCount: 1,
    maxTopUps: 0,
  });
  const id = await engine.start('demo', 'ch1', 'village', { students: ['s_demo'] });
  const p = engine.payload(id);
  console.log('question:', p.question, p.choices ?? '');
  const res = await engine.answer(
    id,
    's_demo',
    p.kind === 'choice' ? { choice: 0 } : { text: 'the square' },
  );
  console.log('feedback:', res.feedback);
  console.log('events:', events.map((e) => e.t).join(', '));
  console.log(`LLM calls used: ${llm.used()} / ${MAX_CALLS}`);
}

main().catch((e) => {
  console.error('realkey script failed:', (e as Error).message);
  process.exitCode = 1;
});
