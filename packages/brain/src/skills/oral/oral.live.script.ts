// Guarded live demo (NOT a test): one short exam against the fixture course with the real Gemini key.
//   pnpm --filter @squad/brain exec tsx --env-file=../../.env src/skills/oral/oral.live.script.ts
// At most ~5 LLM calls (3 questions, 1-2 judgements). No loops, no retries. Any error (for example
// "HTTP 402 credits depleted") prints "demo mode" and exits 0: the examiner itself already falls back to
// chapter-title questions in that case.
import { openMemoryDb, GeminiLlm } from '@squad/core/node';
import { createCourseStore, loadFixtureCourse } from '../../ingest';
import { createOralExaminer } from './index';

async function main(): Promise<void> {
  if (!process.env.GEMINI_API_KEY) {
    console.log('demo mode (no GEMINI_API_KEY)');
    return;
  }
  const store = createCourseStore(openMemoryDb());
  await loadFixtureCourse({ store }, 'demo');
  const ex = createOralExaminer({
    store,
    llm: new GeminiLlm(),
    courseId: 'demo',
    questions: 2,
  }).begin({
    student: 's_demo',
  });
  const say = (who: string, ls: { text: string }[]) =>
    ls.forEach((l) => console.log(`${who}: ${l.text}`));
  say('examiner', await ex.greeting());
  const answers = ['I am not sure, but I think it is about keeping the cost low overall.', 'skip'];
  for (const a of answers) {
    if (ex.done()) break;
    console.log(`student: ${a}`);
    say('examiner', await ex.reply(a));
  }
  console.log(`done: ${ex.done()}`);
}

main().catch(() => {
  console.log('demo mode');
});
