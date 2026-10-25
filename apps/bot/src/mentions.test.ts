import { describe, expect, it } from 'vitest';
import { FakeLlm, type Skill, type VillageEvent } from '@squad/core';
import { createTestBot } from './testing';
import { BANTER, BANTER_NEAR_MISS } from './adversarial/banter';

const G = 'group:test';
const quizSkill: Skill = {
  name: 'quiz',
  async match() {
    return 0;
  },
  async handle(m) {
    return [{ chatId: m.chatId, text: `quiz got: ${m.text}` }];
  },
};
const councilSkill: Skill = { ...quizSkill, name: 'council' };
const mk = () =>
  createTestBot({
    skills: [quizSkill, councilSkill],
    llm: new FakeLlm({ fallback: 'fake reply' }),
  });
const texts = (t: ReturnType<typeof mk>, to?: string) =>
  t.sent.filter((s) => !to || s.chatId === to).map((s) => s.text ?? '');

describe('explicit agent mentions', () => {
  it('@cubbie and @cubbi both reach the router (Cubbie-prefixed)', async () => {
    for (const w of ['@cubbie', '@Cubbi', '@CUBBIE', '@squad']) {
      const t = mk();
      await t.say('s_ana', G, `${w} what is a z-score?`);
      expect(texts(t, G)).toHaveLength(1);
      expect(texts(t, G)[0]).toMatch(/^\u{1F43B} Cubbie: /u);
    }
  });
  it('@tutor always replies, persona-prefixed, even with a low policy score', async () => {
    const t = mk();
    const r = await t.say('s_ana', G, '@tutor explain the normal distribution');
    expect(r.decision).toMatchObject({ action: 'run', reason: 'mentioned' });
    expect(texts(t, G)).toHaveLength(1);
    expect(texts(t, G)[0]).toMatch(/Tutor: /);
    expect(texts(t, G)[0]).not.toMatch(/Cubbie/);
  });
  it('teacher is a tutor alias; chairman and chill and grind have their own voice', async () => {
    const t = mk();
    await t.say('s_ana', G, '@teacher hi there');
    await t.say('s_ben', G, '@chairman decide please');
    await t.say('s_cam', G, '@grind how much should I study');
    const out = texts(t, G);
    expect(out[0]).toMatch(/Tutor: /);
    expect(out[1]).toMatch(/Chairman: /);
    expect(out[2]).toMatch(/Grind: /);
  });
  it('multiple mentions fan out in order, capped at 3', async () => {
    const t = mk();
    await t.say('s_ana', G, '@skeptic @tutor @planner @examiner is this right?');
    const out = texts(t, G);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/Skeptic: /);
    expect(out[1]).toMatch(/Tutor: /);
    expect(out[2]).toMatch(/Planner: /);
  });
  it('@council convenes the council skill; skill aliases run their skill', async () => {
    const t = mk();
    await t.say('s_ana', G, '@council is mitosis the same as meiosis?');
    await t.say('s_ana', G, '@quiz chapter 6');
    const out = texts(t, G);
    expect(out[0]).toContain('quiz got: @cubbie council is mitosis');
    expect(out[1]).toContain('quiz got: @cubbie quiz me chapter 6');
  });
  it('a skill alias whose skill is not registered says so instead of staying silent', async () => {
    const t = mk();
    await t.say('s_ana', G, '@podcast on chapter 2');
    expect(texts(t, G)[0]).toContain('not available');
  });
  it('a bare @cubbi gets a short what-do-you-need reply', async () => {
    const t = mk();
    await t.say('s_ana', G, '@cubbi');
    expect(texts(t, G)).toHaveLength(1);
    expect(texts(t, G)[0]).toContain('What do you need?');
    expect(texts(t, G)[0]).toMatch(/Cubbie: /);
  });
  it('works in a DM too', async () => {
    const t = mk();
    await t.say('s_ana', 'dm', '@skeptic prove it');
    expect(texts(t, 'dm:s_ana')[0]).toMatch(/Skeptic: /);
  });
  it('emits an agent.state naming the addressed agent (existing event kinds only)', async () => {
    const t = mk();
    await t.say('s_ana', G, '@tutor explain z');
    const ev = t.events.filter((e: VillageEvent) => e.t === 'agent.state') as any[];
    expect(
      ev.some(
        (e) =>
          e.state === 'studying' && /@tutor/.test(e.thought ?? '') && e.work?.skill === 'tutor',
      ),
    ).toBe(true);
    expect(ev.at(-1).state).toBe('idle');
  });
  it('a duplicate delivery does not answer twice', async () => {
    const t = mk();
    await t.say('s_ana', G, '@tutor explain z', { ts: 5 });
    await t.say('s_ana', G, '@tutor explain z', { ts: 5 });
    expect(texts(t, G)).toHaveLength(1);
  });
  it('a failing LLM still answers (apology), never silence', async () => {
    const t = createTestBot({
      llm: {
        complete: async () => {
          throw new Error('boom');
        },
      } as never,
    });
    await t.say('s_ana', G, '@tutor explain z');
    expect(texts(t, G)).toHaveLength(1);
    expect(texts(t, G)[0]).toMatch(/Tutor: Sorry/);
  });
});

describe('unknown tags', () => {
  it('in a group: help goes to the sender DM, the group only sees "Sent you a DM"', async () => {
    const t = mk();
    await t.say('s_ana', G, '@nobodyhome help');
    expect(texts(t, 'dm:s_ana')).toHaveLength(1);
    expect(texts(t, 'dm:s_ana')[0]).toContain("I don't know @nobodyhome");
    expect(texts(t, 'dm:s_ana')[0]).toContain('@tutor');
    expect(texts(t, G)).toHaveLength(1);
    expect(texts(t, G)[0]).toContain('Sent you a DM');
    expect(texts(t, G)[0]).not.toContain('nobodyhome');
  });
  it('is rate limited per sender, and other senders still get help', async () => {
    const t = mk();
    await t.say('s_ana', G, '@zzz one');
    await t.say('s_ana', G, '@yyy two');
    expect(texts(t, 'dm:s_ana')).toHaveLength(1);
    await t.say('s_ben', G, '@yyy two');
    expect(texts(t, 'dm:s_ben')).toHaveLength(1);
    t.advance(61_000);
    await t.say('s_ana', G, '@www three');
    expect(texts(t, 'dm:s_ana')).toHaveLength(2);
  });
  it('in a DM the help is the reply, once', async () => {
    const t = mk();
    await t.say('s_ana', 'dm', '@nobodyhome help');
    expect(texts(t, 'dm:s_ana')).toHaveLength(1);
    expect(texts(t, 'dm:s_ana')[0]).toContain("I don't know");
  });
  it('known plus unknown: the known agent answers and help is sent', async () => {
    const t = mk();
    await t.say('s_ana', G, '@tutor and @bob explain z');
    expect(texts(t, G).some((x) => /Tutor: /.test(x))).toBe(true);
    expect(texts(t, 'dm:s_ana')).toHaveLength(1);
  });
  it('hostile unknown words are sanitised in the help', async () => {
    const t = mk();
    await t.say('s_ana', G, '@a1_<b>');
    const h = texts(t, 'dm:s_ana')[0] ?? '';
    expect(h).not.toContain('<');
  });
});

describe('banter stays silent', () => {
  it('the 50-line banter suite and 30 near-misses produce no reply and no help DM', async () => {
    const t = mk();
    for (const line of [...BANTER, ...BANTER_NEAR_MISS]) {
      await t.say('s_ana', G, line);
      t.advance(1000);
    }
    expect(t.sent.map((s) => s.text)).toEqual([]);
  });
  it('@cubbie after banter still answers', async () => {
    const t = mk();
    await t.say('s_ana', G, 'cubbie is slow');
    await t.say('s_ana', G, 'hey @cubbi, what is a p-value?');
    expect(texts(t, G)).toHaveLength(1);
  });
});

describe('privacy', () => {
  it('a mention in a group never copies DM history or private values into the group reply', async () => {
    const seen: string[] = [];
    const t = createTestBot({
      llm: {
        complete: async (r: { system?: string; messages: unknown }) => {
          seen.push(JSON.stringify(r));
          return { text: 'ok' };
        },
      } as never,
    });
    await t.say('s_ana', 'dm', 'my secret budget is $4242');
    seen.length = 0;
    await t.say('s_ben', G, '@tutor what is a z-score?');
    expect(seen.join('')).not.toContain('4242');
    expect(texts(t, G).join('')).not.toContain('4242');
  });
  it('unknown-tag help is never posted to the group', async () => {
    const t = mk();
    await t.say('s_ana', G, '@nobodyhome');
    expect(texts(t, G).join(' ')).not.toContain('@tutor');
  });
});
