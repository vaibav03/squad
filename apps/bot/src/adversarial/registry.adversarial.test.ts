// The full registry (chat, brain, quiz, feynman, stepDiff, studyPlan, podcast, explainer) must keep a
// quiet group quiet: no skill may score >= the 0.8 speaking threshold on banter, and the bot sends nothing.
import { describe, expect, it } from 'vitest';
import { FakeLlm, type Ctx, type InboundMessage, type Skill } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { DEFAULT_POLICY } from '../policy';
import { createSkills } from '../skills';
import { buildMedia } from '../wiring';
import { createTestBot } from '../testing';
import { BANTER } from './banter';

async function fullRegistry(): Promise<{ skills: Skill[]; db: ReturnType<typeof openMemoryDb> }> {
  const llm = new FakeLlm({ fallback: 'fake reply' });
  const db = openMemoryDb();
  const cfg = {
    geminiModels: {},
    hubBaseUrl: 'http://x',
    internalEventsSecret: 's',
    dbPath: ':memory:',
    live: false,
  };
  const { media } = buildMedia({ cfg, llm, fake: true });
  return { skills: await createSkills({ llm, db, emit: () => {}, media }), db };
}

const NOT_MENTIONED = (text: string, i: number): InboundMessage => ({
  chatId: 'group:test',
  isGroup: true,
  from: `s_${['ana', 'ben', 'cam', 'dee'][i % 4]}`,
  text,
  attachments: [],
  mentionsBot: false,
  ts: i,
});

describe('full registry on banter', () => {
  it('registers every expected skill once', async () => {
    const { skills } = await fullRegistry();
    expect(skills.map((s) => s.name).sort()).toEqual(
      [
        'behind',
        'chat',
        'coursePlan',
        'doubt',
        'explainer',
        'feynman',
        'hwpolicy',
        'podcast',
        'quiz',
        'stepDiff',
        'studyPlan',
      ].sort(),
    );
  });

  it('no skill scores >= 0.8 on any of the 50 banter lines', async () => {
    const { skills, db } = await fullRegistry();
    const ctx = { db } as unknown as Ctx;
    const hot: string[] = [];
    for (const [i, line] of BANTER.entries())
      for (const s of skills) {
        const score = await s.match(NOT_MENTIONED(line, i), ctx);
        if (score >= DEFAULT_POLICY.threshold) hot.push(`${s.name}=${score} on "${line}"`);
      }
    expect(hot).toEqual([]);
  });

  it('the bot stays silent through 50 lines of banter with all skills registered', async () => {
    const { skills } = await fullRegistry();
    const t = createTestBot({ skills, chat: false });
    for (const [i, line] of BANTER.entries())
      await t.say(`s_${['ana', 'ben', 'cam', 'dee'][i % 4]}`, 'group:test', line, { ts: i });
    expect(t.sent).toEqual([]);
    expect(t.decisions()).toHaveLength(BANTER.length);
    expect(t.decisions().filter((d) => d.decision.action !== 'quiet')).toEqual([]);
  });
});
