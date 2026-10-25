/**
 * Dumps the REAL events emitted by the debate skill (FakeLlm over the committed sample course) to
 * JSON, so the village capture (packages/village capture-rooms-a) can paint the stage from them.
 *   pnpm --dir packages/brain exec tsx src/skills/debate/events.script.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FakeLlm, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCourseStore, loadFixtureCourse } from '../../ingest';
import { splitPages } from '../../feynman/quote';
import { runDebate } from './debate';

const out = resolve(process.argv[2] ?? 'docs/design/shots/rooms-a/events');
const db = openMemoryDb();
const store = createCourseStore(db);
await loadFixtureCourse({ store }, 'demo');
const chapter = store.listChapters('demo')[0]!.id;
const context = store.chapterContext('demo', chapter);
const page = splitPages(context).find((p) => p.text.trim().split(/\s+/).length > 12)!;
const quote = page.text.trim().split(/\s+/).slice(0, 9).join(' ');

const llm = new FakeLlm({
  fallback: (req) => {
    const sys = (req as { system?: string }).system ?? '';
    const text = JSON.stringify((req as { messages?: unknown }).messages ?? '');
    if (sys.includes('frame a classroom debate'))
      return { pro: 'Read the chapter first', con: 'Start with practice questions' };
    if (text.includes('Rank the other members')) return { order: [] };
    if (sys.includes('You are the chair'))
      return {
        winner: 'pro',
        text: 'Pro tied the claim to the page; Con only asserted it.',
      };
    const pro = sys.includes('You are Pro');
    return pro
      ? {
          text: 'The chapter defines the terms the questions use, so reading it first removes guesswork.',
          answer: 'Read first',
          cite: { file: page.file, page: page.page, quote },
        }
      : {
          text: 'Questions show what the exam asks; reading can wait until you hit a gap.',
          answer: 'Practice first',
          cite: null,
        };
  },
});
const events: VillageEvent[] = [];
const res = await runDebate(
  { llm, emit: (e) => void events.push(e) },
  {
    question: 'Should we read the chapter before doing practice questions?',
    material: { context, chapter },
    students: ['s_ana', 's_bo', 's_cy'],
    askVote: async (s) => (s === 's_cy' ? 'con' : 'pro'),
  },
);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'debate.json'), JSON.stringify(events, null, 2));
console.log(
  `debate: ${events.length} events, winner ${res.winner}, citations ${JSON.stringify(res.citations)}`,
);
