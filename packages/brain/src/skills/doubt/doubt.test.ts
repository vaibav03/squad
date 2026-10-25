import { describe, expect, it } from 'vitest';
import { NOT_IN_MATERIALS } from '../../experts/types';
import { BrainUnavailableError, grounded, makeSkillKit, msg, ungrounded } from '../testkit';
import { UNAVAILABLE_TEXT, createDoubtSkill } from './index';

describe('doubtSkill', () => {
  it('answers a grounded question with the expert text, after stripping the mention', async () => {
    const k = await makeSkillKit({
      ask: () => grounded('A z-score counts standard deviations. (ch6.pdf p.2)'),
    });
    const out = await createDoubtSkill(k.brain).handle(msg('@cubbie what is a z-score?'), k.ctx);
    expect(out).toEqual([
      { chatId: 'group:t', text: 'A z-score counts standard deviations. (ch6.pdf p.2)' },
    ]);
    expect(k.asked).toEqual(['what is a z-score?']);
  });

  it("replies exactly 'not in the materials' when ungrounded", async () => {
    const k = await makeSkillKit({ ask: () => ungrounded });
    const out = await createDoubtSkill(k.brain).handle(msg("@cubbie what's on the final?"), k.ctx);
    expect(out[0]!.text).toBe(NOT_IN_MATERIALS);
  });

  it('an unavailable brain is reported honestly, never fabricated', async () => {
    const k = await makeSkillKit({
      ask: () => {
        throw new BrainUnavailableError('quota');
      },
    });
    const out = await createDoubtSkill(k.brain).handle(msg('@cubbie why?'), k.ctx);
    expect(out[0]!.text).toBe(UNAVAILABLE_TEXT);
  });

  it.each([
    ['@cubbie why does MSE have a 2?', true, 0.9],
    ['@cubbie hello there', true, 0.4],
    ['why does MSE have a 2?', false, 0.2],
    ['lol ok', false, 0],
    ['@cubbie just do HW3 Q2', true, 0],
    ['@cubbie am I behind?', true, 0],
  ])('match(%j)', async (text, mentionsBot, want) => {
    const k = await makeSkillKit();
    expect(await createDoubtSkill(k.brain).match(msg(text, { mentionsBot }), k.ctx)).toBe(want);
  });

  it('never scores 0.8+ without a mention (cannot speak unprompted)', async () => {
    const k = await makeSkillKit();
    const s = createDoubtSkill(k.brain);
    for (const t of ['why does this work?', 'what is variance?', 'explain the empirical rule']) {
      expect(await s.match(msg(t, { mentionsBot: false }), k.ctx)).toBeLessThan(0.8);
    }
  });
});
