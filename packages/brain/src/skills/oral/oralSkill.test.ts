import { describe, expect, it } from 'vitest';
import { VillageEventSchema, type VillageEvent } from '@squad/core';
import { msg } from '../testkit';
import { createOralSkill } from './oralSkill';

describe('oral skill', () => {
  const events: VillageEvent[] = [];
  const skill = createOralSkill({ emit: (e) => void events.push(e) });
  const ctx = {} as never;
  it('fires only when addressed and on the phrase', async () => {
    expect(await skill.match(msg('@cubbie oral exam'), ctx)).toBe(0.95);
    expect(await skill.match(msg('@cubbie practice an oral'), ctx)).toBe(0.95);
    expect(await skill.match(msg('oral exam tomorrow ugh', { mentionsBot: false }), ctx)).toBe(0);
    for (const t of ['@cubbie lol', '@cubbie quiz me on ch1', '@cubbie plan my next semester'])
      expect(await skill.match(msg(t), ctx), t).toBe(0);
  });
  it('rings the hut door and explains, never grades', async () => {
    const out = await skill.handle(msg('@cubbie oral exam'), ctx);
    expect(out[0]!.text).toMatch(/Oral Exam Hut/);
    expect(out[0]!.text).toMatch(/No grades/);
    expect(events).toHaveLength(1);
    expect(VillageEventSchema.safeParse(events[0]).success).toBe(true);
    expect(events[0]).toMatchObject({ agent: 'expert:oral', state: 'waiting_for_student' });
  });
});
