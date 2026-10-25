// Adversarial suite for the speaking policy. Attack classes:
//  banter corpus (must stay silent), near-miss mentions (cubbies, scrubbie, emails), threshold and
//  cooldown boundaries, mention during cooldown, bursts, duplicate delivery, bot-echo loops,
//  hostile skills (throw, hang, NaN, negative, >1, huge output, empty output), persona double-prefix,
//  per-chat isolation, decision_json completeness.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Skill } from '@squad/core';
import { decide } from '../policy';
import { createTestBot } from '../testing';

const BANTER = [
  'lol',
  'anyone free tonight',
  'did you see the game',
  'omg that exam was brutal',
  'ok',
  'brb',
  'haha no way',
  'who is bringing snacks',
  'I can not believe it is only Tuesday',
  'pizza?',
  'my professor is a legend',
  'we should study at the library',
  'ugh',
  'running 5 min late',
  'did anyone do the reading',
  'cubbies are the best team',
  'scrubbie',
  'I told cubbie yesterday',
  'email me@cubbie.com',
  'the cubbie bot is slow',
  'what time is lab',
  'sent you the notes',
  'thx!!',
  'lmaooo',
  'see you at 3',
  'can someone share the doc',
  'this chapter is dense',
  'I need coffee',
  'does anyone have a charger',
  'happy birthday!!',
  'nice',
  'wow',
  'wait what',
  'no thanks',
  'yes',
  'maybe',
  '1',
  '2',
  'sounds good',
  'same',
  'right?',
  'true',
  'fr',
  'I am so tired',
  'lets go',
  'good luck everyone',
  'are we still on for friday',
  'k',
  'idk',
  'ttyl',
];

const stub = (name: string, score: number | (() => number), text = `from ${name}`): Skill => ({
  name,
  match: async () => (typeof score === 'function' ? score() : score),
  handle: async (m) => [{ chatId: m.chatId, text }],
});

describe('banter and mentions', () => {
  it('stays silent through 50 lines of banter with only the chat skill', async () => {
    const t = createTestBot();
    for (const [i, line] of BANTER.entries())
      await t.say(`s_${['ana', 'ben', 'cam', 'dee'][i % 4]}`, 'group:test', line, { ts: i });
    expect(t.sent).toEqual([]);
    expect(t.decisions()).toHaveLength(BANTER.length);
  });

  it.each([
    '@cubbie hi',
    '@CUBBIE hi',
    'Hey Cubbie, quiz me',
    'cubbie, help',
    'ok cubbie what now',
    'thoughts @cubbie?',
  ])('answers %j exactly once', async (text) => {
    const t = createTestBot();
    await t.say('s_ana', 'group:test', text);
    await t.say('s_ana', 'group:test', text); // duplicate delivery
    expect(t.sent).toHaveLength(1);
  });
});

describe('unprompted limits', () => {
  it('0.79 quiet, 0.8 speaks', async () => {
    for (const [score, n] of [
      [0.79, 0],
      [0.8, 1],
    ] as const) {
      const t = createTestBot({ skills: [stub('s', score)] });
      await t.say('s_ana', 'group:test', 'x');
      expect(t.sent).toHaveLength(n);
    }
  });

  it('cooldown boundary at exactly 120s; mention during cooldown does not reset it', async () => {
    const t = createTestBot({ skills: [stub('s', 0.9)] });
    await t.say('s_ana', 'group:test', 'a');
    t.advance(119_999);
    await t.say('s_ben', 'group:test', 'b');
    expect(t.sent).toHaveLength(1);
    await t.say('s_cam', 'group:test', '@cubbie yo');
    expect(t.sent).toHaveLength(2);
    t.advance(1);
    await t.say('s_dee', 'group:test', 'c');
    expect(t.sent).toHaveLength(3);
  });

  it('property: never more than one unprompted message per 120s window per chat', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 90_000 }), { minLength: 2, maxLength: 25 }),
        async (gaps) => {
          const t = createTestBot({ skills: [stub('s', 0.95)], chat: false });
          const times: number[] = [];
          for (const [i, g] of gaps.entries()) {
            t.advance(g);
            const before = t.sent.length;
            await t.say('s_ana', 'group:test', `m${i}`, { ts: i + 1 });
            if (t.sent.length > before) times.push(t.now());
          }
          for (let i = 1; i < times.length; i++)
            expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(120_000);
        },
      ),
      { seed: 99, numRuns: 40 },
    );
  });

  it('property: decide() is quiet for every unmentioned group message below threshold', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 0.7999, noNaN: true }), { maxLength: 6 }),
        (xs) => {
          const d = decide(
            {
              chatId: 'g',
              isGroup: true,
              from: 'a',
              text: 'x',
              attachments: [],
              mentionsBot: false,
              ts: 0,
            },
            xs.map((score, i) => ({ skill: `s${i}`, score, ms: 0 })),
            { now: 1e9 },
          );
          expect(d.action).toBe('quiet');
        },
      ),
      { seed: 5 },
    );
  });

  it('a same-tick burst of 20 high-score messages yields one unprompted reply', async () => {
    const t = createTestBot({ skills: [stub('s', 0.99)] });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => t.say('s_ana', 'group:test', 'burst', { ts: i })),
    );
    expect(t.sent).toHaveLength(1);
  });

  it('chats are independent', async () => {
    const t = createTestBot({ skills: [stub('s', 0.9)] });
    await t.say('s_ana', 'group:a', 'x');
    await t.say('s_ana', 'group:b', 'x');
    expect(t.sent).toHaveLength(2);
  });
});

describe('loops and DMs', () => {
  it('echoes of the bot own messages never trigger a skill', async () => {
    let calls = 0;
    const t = createTestBot({ skills: [stub('s', () => (calls++, 1))] });
    await t.say('bot', 'group:test', '@cubbie hi', { ts: 1 });
    await t.say('bot', 'dm', 'hello', { ts: 2 });
    expect(t.sent).toEqual([]);
    expect(calls).toBe(0);
  });

  it('a DM is always answered, even when every skill scores 0', async () => {
    const t = createTestBot({ chat: false, skills: [stub('s', 0)] });
    await t.say('s_ana', 'dm', 'hi');
    expect(t.sent).toHaveLength(1);
  });

  it('DMs to a student with a pending confirm never reach skills', async () => {
    let seen = 0;
    const spy: Skill = { name: 'spy', match: async () => (seen++, 1), handle: async () => [] };
    const t = createTestBot({ skills: [spy] });
    void t.bot.ctx.askConfirm('s_ana', 'Q', ['a', 'b'], 't');
    await new Promise((r) => setTimeout(r, 5));
    await t.answerConfirm('s_ana', 'banana');
    await t.answerConfirm('s_ana', '1');
    expect(seen).toBe(0);
  });
});

describe('hostile skills', () => {
  const nasty: Skill[] = [
    {
      name: 'nan',
      match: async () => NaN,
      handle: async () => [{ chatId: 'group:test', text: 'NAN WON' }],
    },
    {
      name: 'neg',
      match: async () => -5,
      handle: async () => [{ chatId: 'group:test', text: 'NEG WON' }],
    },
    {
      name: 'big',
      match: async () => 99,
      handle: async (m) => [{ chatId: m.chatId, text: 'x'.repeat(100_000) }],
    },
    { name: 'hang', match: () => new Promise(() => {}), handle: async () => [] },
    {
      name: 'throw',
      match: async () => {
        throw new Error('x');
      },
      handle: async () => [],
    },
  ];
  it('NaN/negative/hanging/throwing matchers cannot make the bot speak in banter', async () => {
    const t = createTestBot({
      chat: false,
      skills: nasty.filter((s) => s.name !== 'big'),
      scoreTimeoutMs: 20,
    });
    await t.say('s_ana', 'group:test', 'just chatting');
    expect(t.sent).toEqual([]);
  });
  it('clamped >1 scores still respect the cooldown, and huge output does not crash', async () => {
    const t = createTestBot({ chat: false, skills: [nasty[2]!], scoreTimeoutMs: 20 });
    await t.say('s_ana', 'group:test', 'a');
    await t.say('s_ana', 'group:test', 'b');
    expect(t.sent).toHaveLength(1);
  });
  it('empty output and empty text send nothing and do not consume the cooldown slot', async () => {
    let mode: 'empty' | 'ok' = 'empty';
    const s: Skill = {
      name: 's',
      match: async () => 0.9,
      handle: async (m) =>
        mode === 'empty'
          ? [{ chatId: m.chatId, text: '' }, { chatId: m.chatId }]
          : [{ chatId: m.chatId, text: 'ok' }],
    };
    const t = createTestBot({ chat: false, skills: [s] });
    await t.say('s_ana', 'group:test', 'a');
    expect(t.sent).toEqual([]);
    mode = 'ok';
    await t.say('s_ana', 'group:test', 'b');
    expect(t.sent).toHaveLength(1);
  });
  it('persona prefix is applied once even if the skill already prefixed it', async () => {
    const s: Skill = {
      name: 's',
      match: async () => 1,
      handle: async (m) => [{ chatId: m.chatId, text: '\u{1F43B} Nook: hi' }],
    };
    const t = createTestBot({ skills: [s], chat: false });
    await t.say('s_ana', 'dm', 'x');
    expect(t.sent[0]!.text).toBe('\u{1F43B} Nook: hi');
  });
});

describe('isolation and audit', () => {
  it('a slow skill in chat A does not delay chat B', async () => {
    let release!: () => void;
    const slow: Skill = {
      name: 'slow',
      match: async (m) => (m.chatId === 'group:a' ? 1 : 0),
      handle: (m) => new Promise((r) => (release = () => r([{ chatId: m.chatId, text: 'late' }]))),
    };
    const t = createTestBot({ skills: [slow] });
    const a = t.say('s_ana', 'group:a', 'x');
    await new Promise((r) => setTimeout(r, 5));
    const t0 = Date.now();
    await t.say('s_ben', 'group:b', '@cubbie hi');
    expect(Date.now() - t0).toBeLessThan(500);
    release();
    await a;
  });
  it('every inbound message, quiet or not, has a decision with scores and a reason', async () => {
    const t = createTestBot({ skills: [stub('s', 0.5)] });
    await t.say('s_ana', 'group:test', 'quiet one');
    await t.say('s_ana', 'group:test', '@cubbie loud one');
    for (const { decision } of t.decisions()) {
      expect(decision.reason).toBeTruthy();
      expect(decision.scores.length).toBeGreaterThan(0);
    }
  });
});
