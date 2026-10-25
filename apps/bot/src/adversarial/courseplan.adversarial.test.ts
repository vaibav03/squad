// The coursePlan skill (Round Table) must be silent on banter and unaddressed text, fire on the
// planning phrases, and leave the study-plan phrases to studyPlan.
import { describe, expect, it } from 'vitest';
import { FakeLlm, type Ctx, type InboundMessage, type Skill } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createSkills } from '../skills';
import { createTestBot } from '../testing';
import { BANTER } from './banter';

const mk = (text: string, mentionsBot: boolean, i = 0): InboundMessage => ({
  chatId: 'group:test',
  isGroup: true,
  from: 's_ana',
  text,
  attachments: [],
  mentionsBot,
  ts: i,
});

async function registry() {
  const db = openMemoryDb();
  const skills = await createSkills({
    llm: new FakeLlm({ fallback: 'fake reply' }),
    db,
    emit: () => {},
  });
  return { skills, db, ctx: { db } as unknown as Ctx };
}
const byName = (skills: Skill[], n: string) => skills.find((s) => s.name === n)!;

const TRIGGERS = [
  '@cubbie plan my next semester',
  'plan my fall courses',
  'what classes should I take next term',
  'help me pick courses',
];

describe('coursePlan scoring', () => {
  it('is 0 on every banter fixture, addressed or not', async () => {
    const { skills, ctx } = await registry();
    const cp = byName(skills, 'coursePlan');
    for (const [i, line] of BANTER.entries()) {
      expect(await cp.match(mk(line, false, i), ctx), line).toBe(0);
      expect(await cp.match(mk(line, true, i), ctx), line).toBe(0);
    }
  });
  it('is 0 on unaddressed planning text and fires on the four trigger phrases when addressed', async () => {
    const { skills, ctx } = await registry();
    const cp = byName(skills, 'coursePlan');
    for (const t of TRIGGERS) {
      expect(await cp.match(mk(t, false), ctx), t).toBe(0);
      expect(await cp.match(mk(t, true), ctx), t).toBeGreaterThanOrEqual(0.9);
    }
  });
  it('beats every other skill on the trigger phrases, and loses to studyPlan on study phrases', async () => {
    const { skills, ctx } = await registry();
    for (const t of TRIGGERS) {
      const scored = await Promise.all(
        skills.map(async (s) => [s.name, await s.match(mk(t, true), ctx)] as const),
      );
      const top = scored.reduce((a, b) => (b[1] > a[1] ? b : a));
      expect(top[0], `${t} -> ${JSON.stringify(scored)}`).toBe('coursePlan');
    }
    for (const t of ['@cubbie study plan please', '@cubbie plan the midterm']) {
      const scored = await Promise.all(
        skills.map(async (s) => [s.name, await s.match(mk(t, true), ctx)] as const),
      );
      const top = scored.reduce((a, b) => (b[1] > a[1] ? b : a));
      expect(top[0], t).toBe('studyPlan');
      expect(scored.find(([n]) => n === 'coursePlan')![1]).toBe(0);
    }
  });
  it('routes an addressed request through the bot and the group stays quiet on banter', async () => {
    const { skills } = await registry();
    const t = createTestBot({ skills, chat: false });
    for (const [i, line] of BANTER.entries()) await t.say('s_ana', 'group:test', line, { ts: i });
    expect(t.sent).toEqual([]);
  });
});
