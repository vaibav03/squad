// Offline stand-ins used by scripted sessions (`/script` in the REPL and the multi-skill smoke test):
// a scripted FakeLlm keyed on the prompt each brain/media stage sends, the FakeTts media services,
// and the full skill registry on one shared db and emit.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakeLlm, type Db, type Skill, type VillageEvent } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { FIXTURE_DIR } from '@squad/brain';
import { createSkills } from '../skills';
import { buildMedia } from '../wiring';

/** Planted in every quiz explanation: it must only ever reach the answering student's own DM. */
export const QUIZ_SECRET = 'Zq-key-4471';

interface Golden {
  question: string;
  chapter: string;
  file: string;
  page: number;
  quote: string;
}
const golden = (): Golden =>
  (
    JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'golden.json'), 'utf8')) as {
      answerable: Golden[];
    }
  ).answerable.find((a) => a.question.includes('empirical rule'))!;

const TURN =
  'The empirical rule says about sixty eight percent of values fall within one standard deviation of the mean, so we use it as a quick sanity check on bell shaped data.';

export function scriptedLlm(): FakeLlm {
  const g = golden();
  const turns = Array.from({ length: 8 }, (_, i) => ({
    speaker: i % 2 ? 'rival' : 'cubbie',
    text: TURN,
    kind: 'banter',
  }));
  return new FakeLlm({
    fallback: (req) => {
      const system = req.system ?? '';
      if (system.includes('You are the Dean')) return { chapters: [g.chapter] };
      if (system.includes('two-host study podcast')) return { turns };
      if (system.includes('strict fact checker')) return { checks: [] };
      if (system.includes('You write quiz questions'))
        return {
          questions: Array.from({ length: 3 }, (_, i) => ({
            kind: 'choice',
            question: `Q${i}: which describes the normal curve?`,
            choices: ['skewed', 'symmetric'],
            key: 1,
            explanation: QUIZ_SECRET,
          })),
        };
      if (/Student question: /.test(JSON.stringify(req.messages)))
        return {
          answer: '',
          claims: [
            { text: 'It is the 68-95-99.7 rule.', file: g.file, page: g.page, quote: g.quote },
          ],
        };
      return { summary: 'summary of the chapter for routing' };
    },
  });
}

/** Full registry (brain, quiz, feynman, stepdiff, study plan, podcast, explainer) on one db and emit. */
export async function buildSessionSkills(
  emit: (e: VillageEvent) => void = () => {},
  llm: FakeLlm = scriptedLlm(),
): Promise<{ skills: Skill[]; db: Db; llm: FakeLlm }> {
  const db = openMemoryDb();
  const cfg = {
    geminiModels: {},
    hubBaseUrl: 'http://x',
    internalEventsSecret: 's',
    dbPath: ':memory:',
    live: false,
  };
  const { media } = buildMedia({ cfg, llm, fake: true });
  return { skills: await createSkills({ llm, db, emit, media }), db, llm };
}
