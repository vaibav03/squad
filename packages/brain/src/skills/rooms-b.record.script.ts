// Records the events the rooms-b skills emit (FakeLlm unless ROOMS_B_LIVE=1) into a JSON replay the
// room-info dev harness plays: packages/web/src/overlays/room-info/dev/rooms-b-replay.json
//   pnpm --filter @squad/brain exec tsx --env-file=../../.env src/skills/rooms-b.record.script.ts
// With ROOMS_B_LIVE=1 and GEMINI_API_KEY the real model is used; any model error degrades to the
// skills' built-in fallbacks (demo mode) with no retry loops.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakeLlm, type Llm, type VillageEvent } from '@squad/core';
import { GeminiLlm, openMemoryDb } from '@squad/core/node';
import { createCourseStore, loadFixtureCourse } from '../ingest';
import { createMasteryStore } from '../mastery/store';
import { createOracleSkill } from './oracle';
import { createOralExaminer } from './oral';
import { createRubricSkill } from './rubric';
import { msg } from './testkit';

const out = resolve(
  import.meta.dirname,
  '../../../web/src/overlays/room-info/dev/rooms-b-replay.json',
);

const ANSWER =
  'The mean adds all the values and divides by how many there are. I used the median for the skewed data because it ignores the extreme value.';
const RUBRIC = [
  'Clarity - the steps are easy to follow',
  'Accuracy - the right measure of center is used and explained',
  'Completeness - spread is discussed as well as center',
].join('\n');

async function main(): Promise<void> {
  const live = process.env.ROOMS_B_LIVE === '1' && !!process.env.GEMINI_API_KEY;
  const fake = new FakeLlm({
    fallback: (req) => {
      const sys = (req as { system?: string }).system ?? '';
      if (/rubric/i.test(sys))
        return {
          criteria: [
            {
              row: 'clarity',
              met: true,
              comment: 'The order of ideas is easy to follow.',
              evidence: ['The mean adds all the values and divides by how many there are'],
              nextStep: 'Keep one idea per sentence.',
            },
            {
              row: 'accuracy',
              met: true,
              comment: 'You picked the median for skewed data and said why.',
              evidence: ['I used the median for the skewed data'],
              nextStep: 'Name the effect of the extreme value on the mean.',
            },
            {
              row: 'gaps',
              met: false,
              comment: 'Spread is not mentioned at all.',
              evidence: [],
              nextStep: 'Look at how the rubric asks you to describe spread.',
            },
          ],
        };
      return {
        question: 'In your own words, when would you pick the median over the mean?',
        why: 'It is due for review and past exams lean on it.',
      };
    },
  });
  const llm: Llm = live ? new GeminiLlm() : fake;
  const db = openMemoryDb();
  const store = createCourseStore(db);
  await loadFixtureCourse({ store }, 'demo');
  const rec: Record<string, VillageEvent[]> = {
    'exam-oracle': [],
    'rubric-courthouse': [],
    'oral-exam-hut': [],
  };
  const into =
    (slot: string) =>
    (e: VillageEvent): void => {
      rec[slot]!.push(e);
    };
  const ctx = {
    db,
    llm,
    send: async () => {},
    dm: async () => {},
    askConfirm: async () => 'timeout',
  };

  const mastery = createMasteryStore({ db, emit: () => {} });
  const first = store.listChapters('demo')[0];
  if (first) await mastery.record('s_ana', 'demo', first.id, false, Date.now());
  const oracle = createOracleSkill({
    store,
    mastery,
    emit: into('exam-oracle'),
    llm,
    courseIdFor: () => 'demo',
  });
  await oracle.handle(msg('@cubbie exam oracle', { isGroup: false }), ctx as never);

  const rubric = createRubricSkill({
    store,
    emit: into('rubric-courthouse'),
    llm,
    courseIdFor: () => 'demo',
  });
  await rubric.handle(
    msg(`@cubbie rubric check for hw1:\n${ANSWER}\nrubric:\n${RUBRIC}`, { isGroup: false }),
    ctx as never,
  );

  const exam = createOralExaminer({ store, llm, courseId: 'demo', questions: 2 }).begin({
    student: 's_ana',
  });
  const cap = (text: string): VillageEvent => ({
    t: 'call.caption',
    agent: 'expert:oral',
    callId: 'call_demo',
    text,
  });
  rec['oral-exam-hut']!.push({
    t: 'call.start',
    agent: 'expert:oral',
    callId: 'call_demo',
    student: 's_ana',
  });
  for (const l of await exam.greeting()) rec['oral-exam-hut']!.push(cap(l.text));
  for (const a of ['The mean is the sum divided by the count.', 'I am not sure.', 'skip']) {
    if (exam.done()) break;
    for (const l of await exam.reply(a)) rec['oral-exam-hut']!.push(cap(l.text));
  }
  rec['oral-exam-hut']!.push({ t: 'call.end', agent: 'expert:oral', callId: 'call_demo' });

  writeFileSync(out, JSON.stringify(rec, null, 1));
  console.log(
    `${live ? 'live' : 'fake'} replay -> ${out}`,
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.length])),
  );
}
main().catch((e) => {
  console.log('demo mode', e instanceof Error ? e.message : e);
});
