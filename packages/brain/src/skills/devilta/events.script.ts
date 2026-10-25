/**
 * Dumps the REAL events of one Devil's TA round (FakeLlm, sample material): start, one wrong line,
 * then the right one. Used by the village capture.
 *   pnpm --dir packages/brain exec tsx src/skills/devilta/events.script.ts <outDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FakeLlm, type VillageEvent } from '@squad/core';
import { makeSkillKit, msg } from '../testkit';
import { createDevilTaSkill } from './skill';

const CTX =
  '[stats.pdf p.1] The mean is the sum of the values divided by the count. The standard deviation is the square root of the variance. [stats.pdf p.2] The median is the middle value of the sorted data.';
const llm = new FakeLlm({
  fallback: ((req: { system?: string }) => {
    const sys = req.system ?? '';
    if (sys.includes("Devil's TA"))
      return {
        lines: [
          'The mean is the sum of the values divided by the count.',
          'The median is the middle value of the sorted data.',
          'The standard deviation is the square of the variance.',
          'A larger standard deviation means the data are more spread out.',
        ],
        errorLine: 2,
        errorKeywords: ['square'],
        whatIsWrong: 'It is the square root of the variance, not the square.',
        correct: 'The standard deviation is the square root of the variance.',
        cite: { file: 'stats.pdf', page: 1, quote: 'standard deviation is the square root of the variance' },
      };
    if (sys.includes('teaching assistant')) return { nudge: 'That line holds up. Look again.' };
    return { explanation: 'Taking the square root brings the units back to the data units.' };
  }) as never,
});
const kit = await makeSkillKit({ llm });
const events: VillageEvent[] = [];
const skill = createDevilTaSkill({
  emit: (e) => void events.push(e),
  chapters: { chapterContext: async () => CTX },
  courseIdFor: () => 'demo',
  defaultChapter: () => 'ch2',
});
const dm = { isGroup: false, mentionsBot: false };
await skill.handle(msg("devil's TA ch2", dm), kit.ctx);
await skill.handle(msg('line 1', dm), kit.ctx);
await skill.handle(msg('line 3', dm), kit.ctx);
const out = resolve(process.argv[2] ?? 'docs/design/shots/rooms-a/events');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'devil.json'), JSON.stringify(events, null, 2));
console.log(events.map((e) => e.t + ('chapter' in e ? `(${e.chapter})` : '')).join(' '));
