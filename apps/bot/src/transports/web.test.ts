import { describe, expect, it } from 'vitest';
import { FakeLlm, type Skill } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createBot } from '../bot';
import { registerPersonas } from '../persona';
import { chatSkill } from '../skills/chat';
import { TEST_ROSTER } from '../testing';
import { extractCitations, parseQuizCard, stripPersonaPrefix } from './web-format';
import { WebTransport, type WebOutbound } from './web';

function setup(skills: Skill[] = [], confirmTimeoutMs?: number) {
  const out: WebOutbound[] = [];
  const resolved: [string, string, string][] = [];
  const transport = new WebTransport({
    onMessage: (o) => void out.push(o),
    onConfirmResolved: (s, t, a) => void resolved.push([s, t, a]),
  });
  const bot = createBot({
    skills: [chatSkill, ...skills],
    llm: new FakeLlm({ fallback: 'hello from the bot' }),
    transport,
    db: openMemoryDb(),
    roster: TEST_ROSTER,
    confirmTimeoutMs,
  });
  return { out, resolved, transport, bot, start: () => bot.start() };
}

describe('web-format', () => {
  it('strips the persona prefix only when it matches', () => {
    expect(stripPersonaPrefix(undefined, '\u{1F43B} Cubbie: hi there')).toBe('hi there');
    expect(stripPersonaPrefix(undefined, 'hi there')).toBe('hi there');
  });

  it('normalises citations to [file p.N] and lists each once, in order', () => {
    const r = extractCitations(
      'A z-score is a distance (ch6-the-normal-distribution.pdf p.4). Also [ch6-the-normal-distribution.pdf p.4] and (see p.9) and (ch2-descriptive-statistics.pdf p.2).',
    );
    expect(r.text).toBe(
      'A z-score is a distance [ch6-the-normal-distribution.pdf p.4]. Also [ch6-the-normal-distribution.pdf p.4] and (see p.9) and [ch2-descriptive-statistics.pdf p.2].',
    );
    expect(r.citations).toEqual([
      { file: 'ch6-the-normal-distribution.pdf', page: 4, label: 'ch6.pdf p.4' },
      { file: 'ch2-descriptive-statistics.pdf', page: 2, label: 'ch2.pdf p.2' },
    ]);
  });

  it('parses the quiz skill rendering into a card, and rejects look-alikes', () => {
    const q = parseQuizCard(
      'Q2. What does MSE average?\nA) errors\nB) squared errors\nReply with a letter.',
    );
    expect(q?.card).toEqual({
      type: 'quiz',
      index: 1,
      question: 'What does MSE average?',
      input: 'choice',
      choices: [
        { id: 'A', text: 'errors' },
        { id: 'B', text: 'squared errors' },
      ],
    });
    expect(q?.text).toBe('Question 2');
    expect(parseQuizCard('Q1. Explain.\nReply with your answer.')?.card).toMatchObject({
      input: 'free',
    });
    expect(parseQuizCard('Q1. hi\nA) x\nC) y\nReply with a letter.')).toBeUndefined();
    expect(parseQuizCard('Just a normal message')).toBeUndefined();
  });
});

describe('WebTransport through the real router', () => {
  it('a mention in the group is answered into the group, prefix stripped, persona set', async () => {
    const t = setup();
    await t.start();
    await t.transport.inject({ chatId: 'group:sq_demo', from: 's_ana', text: '@cubbie hi' });
    expect(t.out).toHaveLength(1);
    expect(t.out[0]).toMatchObject({
      chatId: 'group:sq_demo',
      personaId: 'cubbie',
      personaName: 'Cubbie',
      text: 'hello from the bot',
    });
  });

  it('@squad is a mention; plain chatter stays quiet', async () => {
    const t = setup();
    await t.start();
    await t.transport.inject({ chatId: 'group:sq_demo', from: 's_ben', text: 'lol same' });
    await t.transport.inject({ chatId: 'group:sq_demo', from: 's_ben', text: '@squad hello?' });
    expect(t.out.map((o) => o.text)).toEqual(['hello from the bot']);
  });

  it('every DM is a mention and the reply goes to that DM', async () => {
    const t = setup();
    await t.start();
    await t.transport.inject({ chatId: 'dm:s_ana', from: 's_ana', text: 'hey' });
    expect(t.out[0]?.chatId).toBe('dm:s_ana');
  });

  it('personas keep their id, name and emoji', async () => {
    registerPersonas([
      { id: 'ta-test', name: 'Tess', role: 'ta', systemPrompt: 'x', emoji: '\u{1F393}' },
    ]);
    const skill: Skill = {
      name: 'ta',
      match: async (m) => (m.mentionsBot ? 0.99 : 0),
      handle: async (m) => [{ chatId: m.chatId, text: 'office hours at 3', personaId: 'ta-test' }],
    };
    const t = setup([skill]);
    await t.start();
    await t.transport.inject({ chatId: 'group:sq_demo', from: 's_chi', text: '@cubbie when?' });
    expect(t.out[0]).toMatchObject({
      personaId: 'ta-test',
      personaName: 'Tess',
      emoji: '\u{1F393}',
      text: 'office hours at 3',
    });
  });

  it('confirm: structured card to the right DM, answered by number, group never sees it', async () => {
    const t = setup();
    await t.start();
    const p = t.bot.ctx.askConfirm('s_ana', 'Book Cabo for $640?', ['Yes', 'No'], 'task_trip_1');
    await new Promise((r) => setTimeout(r, 0));
    expect(t.out).toHaveLength(1);
    expect(t.out[0]).toMatchObject({
      chatId: 'dm:s_ana',
      text: 'Book Cabo for $640?',
      card: { type: 'confirm', taskId: 'task_trip_1', options: ['Yes', 'No'], status: 'pending' },
    });
    // a group message from Ana never answers it
    await t.transport.inject({ chatId: 'group:sq_demo', from: 's_ana', text: '1' });
    // another student's DM does not either
    await t.transport.inject({ chatId: 'dm:s_ben', from: 's_ben', text: '1' });
    await t.transport.inject({ chatId: 'dm:s_ana', from: 's_ana', text: '2' });
    expect(await p).toBe('No');
    expect(t.resolved).toEqual([['s_ana', 'task_trip_1', 'No']]);
  });

  it('confirm timeout resolves the card as timeout', async () => {
    const t = setup([], 20);
    await t.start();
    const a = await t.bot.ctx.askConfirm('s_ana', 'Q?', ['Yes', 'No'], 'task_to');
    expect(a).toBe('timeout');
    expect(t.resolved).toEqual([['s_ana', 'task_to', 'timeout']]);
  });

  it('dm() text from a skill goes to the student DM only', async () => {
    const skill: Skill = {
      name: 'behind-like',
      match: async (m) => (m.mentionsBot && /behind/.test(m.text) ? 0.95 : 0),
      handle: async (m, ctx) => {
        await ctx.dm(m.from, 'You are on track in ch3.');
        return [{ chatId: m.chatId, text: 'Sent you a DM.' }];
      },
    };
    const t = setup([skill]);
    await t.start();
    await t.transport.inject({
      chatId: 'group:sq_demo',
      from: 's_ana',
      text: '@cubbie am I behind?',
    });
    const dm = t.out.find((o) => o.chatId === 'dm:s_ana');
    const grp = t.out.find((o) => o.chatId === 'group:sq_demo');
    expect(dm?.text).toBe('You are on track in ch3.');
    expect(grp?.text).toBe('Sent you a DM.');
    expect(t.out.filter((o) => o.chatId === 'dm:s_ben')).toHaveLength(0);
  });

  it('attachments pass through as local paths', async () => {
    const skill: Skill = {
      name: 'pod',
      match: async (m) => (m.mentionsBot ? 0.99 : 0),
      handle: async (m) => [
        {
          chatId: m.chatId,
          text: 'here',
          attachments: [{ path: '/tmp/a.m4a', mime: 'audio/mp4' }],
        },
      ],
    };
    const t = setup([skill]);
    await t.start();
    await t.transport.inject({ chatId: 'group:sq_demo', from: 's_ana', text: '@cubbie podcast' });
    expect(t.out[0]?.attachments).toEqual([{ path: '/tmp/a.m4a', mime: 'audio/mp4' }]);
  });
});

describe('structured source citations', () => {
  it('a skill reply with citations reaches the web message with its source and quote, deduplicated', async () => {
    const cite = {
      file: 'Homework 4',
      page: 1,
      label: 'Homework 4',
      source: {
        kind: 'canvas_assignment' as const,
        id: 'src_1',
        anchor: 's1',
        title: 'Homework 4',
      },
      quote: 'Homework 4 covers sampling.',
    };
    const skill: Skill = {
      name: 'cites',
      async match() {
        return 0.99;
      },
      async handle(m) {
        return [{ chatId: m.chatId, text: 'Next 1 due: Homework 4', citations: [cite, cite] }];
      },
    };
    const { out, transport, bot, start } = setup([skill]);
    await start();
    await transport.inject({ chatId: 'group:sq1', from: 's_ana', text: '@cubbie what is due' });
    await bot.stop();
    const last = out[out.length - 1]!;
    expect(last.citations).toEqual([cite]);
  });
});
