import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createSkills } from './skills';
import { createTestBot } from './testing';

// Live finding: with the real model a plain doubt in the group chat came back as "Council verdict: ..." (see
// docs/live/FINDINGS.md F-12). The cause was a stale chat history row in the harness, not the router; this pins the
// routing so a plain doubt always goes to the chapter expert and only an explicit council request convenes it.
describe('a plain doubt routes to the doubt skill, never the council', () => {
  async function bot() {
    const db = openMemoryDb();
    const skills = await createSkills({
      llm: new FakeLlm({ fallback: 'x' }),
      db,
      emit: () => {},
      demo: true,
    });
    return createTestBot({ db, skills, chat: false });
  }

  it.each([
    '@cubbie what does a z-score measure?',
    '@cubbie why do we standardize values?',
    'cubbie, how is variance different from standard deviation?',
    '@cubbie what is a normal distribution',
  ])('mentioned doubt: %s', async (text) => {
    const b = await bot();
    const r = await b.say('s_ana', 'group:sq_demo', text);
    expect(r.decision.action).toBe('run');
    expect(r.decision.skill).toBe('doubt');
    const council = r.decision.scores.find((s) => s.skill === 'council');
    expect(council?.score ?? 0).toBe(0);
    expect(r.sent.map((m) => m.text).join(' ')).not.toMatch(/Council verdict/);
  });

  it.each(['@cubbie council: B or C?', '@cubbie ask the council which approach to use'])(
    'an explicit council request still convenes it: %s',
    async (text) => {
      const b = await bot();
      const r = await b.say('s_ana', 'group:sq_demo', text);
      expect(r.decision.skill).toBe('council');
    },
  );
});
