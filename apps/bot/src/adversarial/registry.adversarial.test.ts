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
        'oracle',
        'oral',
        'podcast',
        'quiz',
        'rubric',
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

describe('room skills (oracle, rubric) are anchored', () => {
  const near = [
    'what should we study next week at the library',
    'anyone know the rubric for the essay',
    'who can predict the final',
    'oracle',
    'what is a rubric',
    '@cubbie lol',
  ];
  // Contains the phrase but is not addressed to the bot: must stay quiet.
  const phraseUnaddressed = ['rubric check later?', 'predict my exam score lol', 'exam oracle lol'];
  it('score 0 for oracle and rubric on near-miss chatter, 0.95 on the real phrases', async () => {
    const { skills, db } = await fullRegistry();
    const ctx = { db } as unknown as Ctx;
    const by = (n: string) => skills.find((s) => s.name === n)!;
    for (const [i, line] of near.entries())
      for (const n of ['oracle', 'rubric']) {
        expect(await by(n).match(NOT_MENTIONED(line, i), ctx), `${n}: ${line}`).toBe(0);
        expect(
          await by(n).match({ ...NOT_MENTIONED(line, i), mentionsBot: true }, ctx),
          `${n} addressed: ${line}`,
        ).toBe(0);
      }
    for (const [i, line] of phraseUnaddressed.entries())
      for (const n of ['oracle', 'rubric'])
        expect(await by(n).match(NOT_MENTIONED(line, i), ctx), `${n}: ${line}`).toBe(0);
    const addressed = (text: string): InboundMessage => ({
      ...NOT_MENTIONED(text, 1),
      mentionsBot: true,
    });
    for (const t of [
      '@cubbie exam oracle',
      '@cubbie what should I study next',
      '@cubbie predict my exam',
    ])
      expect(await by('oracle').match(addressed(t), ctx), t).toBe(0.95);
    expect(await by('rubric').match(addressed('@cubbie rubric check: my answer'), ctx)).toBe(0.95);
  });
});
