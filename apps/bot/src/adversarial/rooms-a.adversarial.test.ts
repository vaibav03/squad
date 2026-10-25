// Honest scoring for the rooms-a skills (Debate Stage, Devil's TA): silent on the 50-line banter
// corpus (addressed or not), silent when unaddressed in a group, and the winner on their own phrases.
import { describe, expect, it } from 'vitest';
import { FakeLlm, type Ctx, type InboundMessage, type Skill } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createSkills } from '../skills';
import { createTestBot } from '../testing';
import { BANTER } from './banter';

const mk = (text: string, mentionsBot: boolean, i = 0, isGroup = true): InboundMessage => ({
  chatId: 'group:test',
  isGroup,
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

const ROOMS: Record<string, { triggers: string[]; unaddressedBanter: string[] }> = {
  debate: {
    triggers: [
      '@cubbie debate should exams be open book?',
      '@cubbie debate this',
      '@cubbie debate: mean vs median',
    ],
    unaddressedBanter: [
      'we should debate that',
      'debate club is at 5',
      'debate this',
      'the debate was wild',
    ],
  },
};

for (const [name, cfg] of Object.entries(ROOMS)) {
  describe(`${name} scoring`, () => {
    it('is 0 on every banter fixture, addressed or not, group or DM', async () => {
      const { skills, ctx } = await registry();
      const s = byName(skills, name);
      expect(s, `${name} is registered`).toBeDefined();
      for (const [i, line] of BANTER.entries()) {
        expect(await s.match(mk(line, false, i), ctx), line).toBe(0);
        expect(await s.match(mk(line, true, i), ctx), line).toBe(0);
        expect(await s.match(mk(line, false, i, false), ctx), line).toBe(0);
      }
    });
    it('is 0 on unaddressed group text, even with the trigger words', async () => {
      const { skills, ctx } = await registry();
      const s = byName(skills, name);
      for (const t of [
        ...cfg.unaddressedBanter,
        ...cfg.triggers.map((x) => x.replace('@cubbie ', '')),
      ])
        expect(await s.match(mk(t, false), ctx), t).toBe(0);
    });
    it('fires on the trigger phrases when addressed and beats every other skill', async () => {
      const { skills, ctx } = await registry();
      for (const t of cfg.triggers) {
        const scored = await Promise.all(
          skills.map(async (s) => [s.name, await s.match(mk(t, true), ctx)] as const),
        );
        const top = scored.reduce((a, b) => (b[1] > a[1] ? b : a));
        expect(top[0], `${t} -> ${JSON.stringify(scored)}`).toBe(name);
        expect(top[1]).toBeGreaterThanOrEqual(0.9);
      }
    });
  });
}

describe('rooms-a: the quiet group stays quiet', () => {
  it('sends nothing on the banter corpus', async () => {
    const { skills } = await registry();
    const t = createTestBot({ skills, chat: false });
    for (const [i, line] of BANTER.entries()) await t.say('s_ana', 'group:test', line, { ts: i });
    expect(t.sent).toEqual([]);
  });
});
