import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Db, OutboundMessage } from '@squad/core';
import { loadConfig, openMemoryDb } from '@squad/core/node';
import { createBrain, loadFixtureCourse, normalizeText } from '@squad/brain';
import { createSkills } from '../skills';
import { createTestBot, type TestBot } from '../testing';
import { buildMedia } from '../wiring';
import { kin } from './handlers';
import { createDemoLlm, DEMO_CHAT_REPLY, DemoLlm, isDemoLlm } from './demo-llm';

if (!process.env.PATH?.includes('/opt/homebrew/bin'))
  process.env.PATH = `${process.env.PATH ?? ''}:/opt/homebrew/bin`;

const REFUSAL = 'Not in the materials. Ask the TA.';
const tick = () => new Promise((r) => setTimeout(r, 5));
// replies carry the persona prefix ("🐻 Cubbie: ")
const bare = (s: string | undefined) => (s ?? '').replace(/^\S+ Cubbie: /, '');
const texts = (ms: OutboundMessage[]) => ms.map((m) => bare(m.text)).join('\n');
// the course itself talks about z-scores, so strip that vocabulary before checking for game words
const gamey = (s: string) =>
  /\b(?:xp|streaks?|leaderboard|points?|scores?)\b/i.test(
    s.replace(/z[\s-]?scores?|standard scores?/gi, ''),
  );
const SENTINELS = /\$180|therapy/i;

let db: Db;
let t: TestBot;
let from: (n: number) => OutboundMessage[];

beforeAll(async () => {
  db = openMemoryDb();
  const llm = createDemoLlm();
  const cfg = loadConfig({ env: {} });
  const { media, reason } = buildMedia({ cfg, llm, fake: true });
  expect(reason).toBeUndefined();
  const skills = await createSkills({ llm, db, emit: () => {}, media });
  t = createTestBot({ skills, llm, db });
  from = (n) => t.sent.slice(n);
});

/** Everything the bot sent after `mark`, as one string. */
const since = (mark: number) => texts(from(mark));

describe('DemoLlm basics', () => {
  it('is branded, deterministic and refuses what it does not recognise', async () => {
    const a = createDemoLlm();
    expect(isDemoLlm(a)).toBe(true);
    expect(isDemoLlm({})).toBe(false);
    expect(a).toBeInstanceOf(DemoLlm);
    await expect(
      a.json({ messages: 'hello', schema: z.object({ x: z.number() }) }),
    ).rejects.toThrow(/demo mode cannot handle/);
    expect((await a.complete({ messages: 'hi' })).text).toBe(DEMO_CHAT_REPLY);
    expect(DEMO_CHAT_REPLY).not.toMatch(/gemini|claude|gpt/i);
  });

  it('remembers cached system text by handle id', async () => {
    const a = createDemoLlm();
    const h = await a.createCache({
      system: '[f.pdf p.1]\nThe median is the middle value of the ordered data.',
    });
    const out = (await a.json({
      cache: h,
      messages: 'x "claims"\n\nStudent question: what is the median?',
      schema: z.object({ answer: z.string(), claims: z.array(z.object({ quote: z.string() })) }),
    })) as { claims: { quote: string }[] };
    expect(out.claims[0]!.quote).toContain('median');
  });

  it('writes the same quiz for the same prompt', async () => {
    const db2 = openMemoryDb();
    const brain = createBrain({ llm: createDemoLlm(), db: db2, emit: async () => {} });
    await loadFixtureCourse({ store: brain.store }, 'demo');
    const ctx = brain.store.chapterContext('demo', 'ch2');
    const ask = () =>
      createDemoLlm().json({
        system: 'quizgen-v1',
        messages: `Chapter material:\n${ctx}\n\nWrite 3 questions (x). Avoid repeating: none.\nReturn {"questions": [...]}.`,
        schema: z.object({ questions: z.array(z.any()) }),
      });
    const [x, y] = [await ask(), await ask()];
    expect(x).toEqual(y);
    expect(x.questions).toHaveLength(3);
    for (const q of x.questions as { choices: string[]; key: number; question: string }[]) {
      expect(q.choices).toHaveLength(4);
      expect(new Set(q.choices).size).toBe(4);
      expect(q.question).toContain('_____');
      expect(q.key).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('golden questions from the sample course', () => {
  it('answers every answerable one with a grounded citation and refuses the rest', async () => {
    const golden = JSON.parse(
      readFileSync(
        new URL('../../../../packages/brain/fixtures/golden.json', import.meta.url),
        'utf8',
      ),
    ) as {
      answerable: { question: string; quote: string; file: string }[];
      unanswerable: { question: string }[];
    };
    const brain = createBrain({ llm: createDemoLlm(), db: openMemoryDb(), emit: async () => {} });
    await loadFixtureCourse({ store: brain.store }, 'demo');
    let exact = 0;
    for (const g of golden.answerable) {
      const a = await brain.ask('demo', g.question);
      expect(a.grounded, g.question).toBe(true);
      expect(a.citations.length, g.question).toBeGreaterThan(0);
      if (
        a.claims.some(
          (c) => c.file === g.file && normalizeText(c.quote).includes(normalizeText(g.quote)),
        )
      )
        exact++;
    }
    // extractive keyword matching finds the exact expected sentence for most of them
    expect(exact).toBeGreaterThanOrEqual(10);
    for (const u of golden.unanswerable) {
      const a = await brain.ask('demo', u.question);
      expect(a.grounded, u.question).toBe(false);
      expect(a.text).toBe(REFUSAL);
    }
  });
});

describe('call captions', () => {
  it('writes cited caption lines, and none when the chapter has no support', async () => {
    const brain = createBrain({ llm: createDemoLlm(), db: openMemoryDb(), emit: async () => {} });
    await loadFixtureCourse({ store: brain.store }, 'demo');
    const run = (callId: string, question: string) =>
      brain.captions.run({ callId, courseId: 'demo', chapter: 'ch6', question });
    const lines = await run('c1', 'what is a z-score?');
    expect(lines.some((l) => l.cite?.file === 'ch6-the-normal-distribution.pdf')).toBe(true);
    const none = await run('c2', 'who won the world cup?');
    expect(none).toEqual([{ seq: 0, text: "That isn't in the materials for this chapter." }]);
  });
});

describe('quiz question quality', () => {
  it('never offers two choices from the same word family, in any chapter', async () => {
    const brain = createBrain({ llm: createDemoLlm(), db: openMemoryDb(), emit: async () => {} });
    await loadFixtureCourse({ store: brain.store }, 'demo');
    for (const ch of ['ch2', 'ch3', 'ch6', 'ch12']) {
      const ctx = brain.store.chapterContext('demo', ch);
      const r = (await createDemoLlm().json({
        system: 'quizgen-v1',
        messages: `Chapter material:\n${ctx}\n\nWrite 8 questions (x). Avoid repeating: none.\nReturn {}.`,
        schema: z.object({ questions: z.array(z.any()) }),
      })) as { questions: { question: string; choices: string[]; key: number }[] };
      expect(r.questions.length, ch).toBeGreaterThanOrEqual(3);
      for (const q of r.questions)
        for (const [i, a] of q.choices.entries())
          for (const b of q.choices.slice(i + 1))
            expect(kin(a, b), `${ch}: ${q.question}`).toBe(false);
    }
  });
});

describe('doubt', () => {
  it('answers a z-score question with a citation to the chapter 6 file', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'group:test', '@cubbie what is a z-score?');
    const out = since(mark);
    expect(out).toMatch(/\(ch6-the-normal-distribution\.pdf p\.\d+\)/);
    expect(out.toLowerCase()).toContain('z-score');
    expect(out).not.toContain(REFUSAL);
    expect(gamey(out)).toBe(false);
  });

  const cases: [string, RegExp, string][] = [
    [
      '@cubbie what is the difference between mean and median?',
      /median/i,
      'ch2-descriptive-statistics.pdf',
    ],
    ['@cubbie what are independent events?', /independent/i, 'ch3-probability-topics.pdf'],
    ['@cubbie what is correlation?', /correlation/i, 'ch12-linear-regression.pdf'],
    ['@cubbie what is regression?', /regression/i, 'ch12-linear-regression.pdf'],
    ['@cubbie what is skewness?', /skew/i, 'ch2-descriptive-statistics.pdf'],
    ['@cubbie what is a sample space?', /sample space/i, 'ch3-probability-topics.pdf'],
  ];
  for (const [q, re, file] of cases) {
    it(`answers: ${q}`, async () => {
      const mark = t.sent.length;
      await t.say('s_ben', 'group:test', q);
      const out = since(mark);
      expect(out).toMatch(re);
      expect(out).toContain(`(${file} p.`);
      expect(out).not.toContain(REFUSAL);
    });
  }

  for (const q of [
    '@cubbie who won the 2022 world cup?',
    "@cubbie what's on the final exam?",
    '@cubbie what is the best pizza topping?',
  ]) {
    it(`refuses: ${q}`, async () => {
      const mark = t.sent.length;
      await t.say('s_cam', 'group:test', q);
      expect(since(mark)).toContain(REFUSAL);
    });
  }

  it('falls back to the honest demo reply for chatter', async () => {
    const mark = t.sent.length;
    await t.say('s_dee', 'group:test', '@cubbie hello');
    expect(since(mark)).toContain('demo mode');
  });
});

describe('quiz', () => {
  it('starts in the group, takes letter answers, and gives feedback by DM', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'group:test', '@cubbie quiz ch3');
    const first = from(mark).find((m) => m.chatId === 'group:test')!;
    expect(first.text).toMatch(/Q1\./);
    expect(first.text).toMatch(/A\) .*\nB\) .*\nC\) .*\nD\) /);
    expect(first.text).toContain('Reply with a letter.');

    let shown = 1;
    for (let q = 0; q < 3; q++) {
      t.advance(121_000); // unprompted group replies have a 2 minute cooldown after the bot spoke
      const before = t.sent.length;
      for (const s of ['s_ana', 's_ben', 's_cam', 's_dee']) await t.say(s, 'group:test', 'B');
      const round = from(before);
      const dms = round.filter((m) => m.chatId.startsWith('dm:'));
      expect(dms).toHaveLength(4);
      for (const d of dms)
        expect(bare(d.text)).toMatch(/^(?:Right\.|Not quite\.) From the reading: "/);
      const group = round.filter((m) => m.chatId === 'group:test');
      if (q < 2) {
        expect(bare(group.at(-1)!.text)).toContain(`Q${q + 2}.`);
        shown++;
      } else expect(texts(group)).toContain('That was the last question.');
    }
    expect(shown).toBe(3);
    const all = since(mark);
    expect(gamey(all)).toBe(false);
    expect(all).not.toMatch(SENTINELS);
  });
});

describe('feynman', () => {
  it('asks two naive follow-ups, then gives plain feedback with a cited pointer', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'dm', 'feynman ch6 z-score');
    expect(since(mark)).toContain('Explain "z-score"');
    await t.say('s_ana', 'dm', 'It measures the distance from the average in standard steps.');
    expect(since(mark)).toContain('Wait, I');
    await t.say(
      's_ana',
      'dm',
      'A mark of 85 in a class averaging 70 sits 15 above, so that is 1.5 steps.',
    );
    expect(since(mark)).toContain('one tiny example');
    await t.say('s_ana', 'dm', 'It is the distance from the mean counted in typical steps.');
    const out = since(mark);
    expect(out).toContain('Accuracy: ');
    expect(out).toContain('Completeness: ');
    expect(out).toContain('Plainness: ');
    expect(out).toMatch(/\(ch6-the-normal-distribution\.pdf p\.\d+\)/);
    expect(gamey(out)).toBe(false);
  });
});

describe('stepdiff', () => {
  it('compares typed steps in DMs and posts only where they split', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'group:test', '@cubbie diff');
    expect(since(mark)).toContain('Diff is open');
    await t.say('s_ana', 'dm', 'z = (x - 70) / 10\nz = (85 - 70) / 10\nz = 15 / 10\nz = 1.5');
    expect(since(mark)).toContain('Waiting for the other person');
    await t.say('s_ben', 'dm', 'z = (x - 70) / 10\nz = (85 - 70) / 10\nz = 15 * 10\nz = 150');
    const out = since(mark);
    expect(out).toContain('Both are in');
    expect(out).toMatch(/You agree through step 2\. Step 3 splits\./);
    expect(out).toContain('Defend your step.');
    expect(out).not.toMatch(/\b(?:wrong|incorrect|correct answer)\b/i);
  });

  it('treats equal arithmetic as a match, also from photos (stand-in reading)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-photo-'));
    const img = join(dir, 'work.png');
    writeFileSync(img, Buffer.from('not really a png but the same bytes'));
    const mark = t.sent.length;
    await t.say('s_cam', 'group:test', '@cubbie diff');
    const att = [{ path: img, mime: 'image/png' }];
    await t.say('s_cam', 'dm', '', { attachments: att });
    await t.say('s_dee', 'dm', '', { attachments: att });
    const out = since(mark);
    expect(out).toMatch(/Your steps match all the way through \(\d steps\)\./);
  });
});

describe('behind', () => {
  it('DMs the asker their own summary after a group ask', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'group:test', '@cubbie am i behind?');
    const msgs = from(mark);
    expect(bare(msgs.find((m) => m.chatId === 'group:test')!.text)).toBe('Sent you a DM.');
    const dm = msgs.find((m) => m.chatId === 'dm:s_ana')!;
    expect(dm.text).toMatch(/Weakest right now:/);
    expect(dm.text).toContain('Next step: take a quiz');
    expect(gamey(texts(msgs))).toBe(false);
  });

  it('in a DM answers in the DM', async () => {
    const mark = t.sent.length;
    await t.say('s_ben', 'dm', 'how am i doing?');
    expect(from(mark).every((m) => m.chatId === 'dm:s_ben')).toBe(true);
  });
});

describe('hwpolicy', () => {
  it('hints from the pages, quotes the syllabus line and will not do graded work', async () => {
    const mark = t.sent.length;
    await t.say(
      's_ana',
      'group:test',
      '@cubbie just do my homework on the standard normal distribution',
    );
    const out = since(mark);
    expect(out).toContain('Hint: ');
    expect(out).toMatch(/\(ch6-the-normal-distribution\.pdf p\.\d+\)/);
    expect(out).toContain('Course policy: "');
    expect(out).toContain('not allowed');
    expect(out).toContain("I can't do graded work for you");
    expect(out).not.toMatch(SENTINELS);
  });
});

describe('studyplan', () => {
  it('assigns chapters, confirms each member by DM', async () => {
    const mark = t.sent.length;
    const run = t.say('s_ana', 'group:test', '@cubbie study plan');
    for (const s of ['s_ana', 's_ben', 's_cam', 's_dee']) {
      await tick();
      await t.answerConfirm(s, '1');
    }
    await run;
    const out = since(mark);
    expect(out).toContain('Study plan, one owner per chapter.');
    expect(out).toContain('Everyone confirmed.');
    expect(gamey(out)).toBe(false);
  });
});

describe('media skills', () => {
  const attachments = (ms: OutboundMessage[]) => ms.flatMap((m) => m.attachments ?? []);

  it('podcast produces an audio file for a DM', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'dm', '@cubbie podcast ch6');
    const files = attachments(from(mark));
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.mime).toBe('audio/mp4');
    expect(existsSync(files[0]!.path)).toBe(true);
    expect(since(mark)).toContain('The Normal Distribution');
    expect(since(mark)).not.toMatch(SENTINELS);
  }, 60_000);

  it('explainer produces a png', async () => {
    const mark = t.sent.length;
    await t.say('s_ana', 'group:test', '@cubbie picture it ch3 independent events');
    const files = attachments(from(mark));
    expect(since(mark)).not.toContain("couldn't make that");
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.mime).toBe('image/png');
    expect(existsSync(files[0]!.path)).toBe(true);
    expect(since(mark)).toMatch(/Picture It: Probability Topics/);
  }, 30_000);
});

await tick();
