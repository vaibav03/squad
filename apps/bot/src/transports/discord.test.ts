import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '@squad/core';
import { TEST_ROSTER } from '../testing';
import { SendLimiter } from './common';
import {
  chunkText,
  createDiscordTransport,
  type DiscordClientLike,
  type DiscordMessageLike,
} from './discord';

const BOT = 'bot1';
const roster = {
  ...TEST_ROSTER,
  students: TEST_ROSTER.students.map((s, i) => ({ ...s, handle: `discord:10${i}` })),
};

function fakeClient() {
  let handler: (m: DiscordMessageLike) => void = () => {};
  const sent: { target: string; o: Record<string, unknown> }[] = [];
  const client: DiscordClientLike & {
    emit(m: DiscordMessageLike): Promise<void>;
    destroyed: boolean;
  } = {
    user: { id: BOT },
    destroyed: false,
    on: (_e, fn) => void (handler = fn),
    login: vi.fn(async () => {}),
    destroy: () => void (client.destroyed = true),
    channels: {
      fetch: async (id) => ({ send: async (o) => void sent.push({ target: `ch:${id}`, o }) }),
    },
    users: {
      fetch: async (id) => ({ send: async (o) => void sent.push({ target: `user:${id}`, o }) }),
    },
    emit: async (m) => {
      handler(m);
      await new Promise((r) => setTimeout(r, 5));
    },
  };
  return { client, sent };
}

const msg = (o: Partial<DiscordMessageLike> = {}): DiscordMessageLike => ({
  id: 'm1',
  content: 'hello',
  author: { id: '100', bot: false },
  channelId: 'chan1',
  guildId: 'guild1',
  createdTimestamp: 123,
  mentions: { has: () => false },
  attachments: [],
  ...o,
});

async function setup(extra: Partial<Parameters<typeof createDiscordTransport>[0]> = {}) {
  const { client, sent } = fakeClient();
  const t = createDiscordTransport({
    roster,
    client,
    token: 'secret-token-value',
    sendLimiter: new SendLimiter(0),
    fileExists: () => true,
    ...extra,
  });
  const got: InboundMessage[] = [];
  await t.start((m) => void got.push(m));
  return { t, client, sent, got };
}

describe('discord transport', () => {
  it('normalizes group messages; real mention becomes @cubbie text and mentionsBot', async () => {
    const { client, got } = await setup();
    await client.emit(
      msg({ content: `<@${BOT}> what is DNA`, mentions: { has: (id) => id === BOT } }),
    );
    await client.emit(msg({ content: 'lol', id: 'm2' }));
    await client.emit(msg({ content: 'hey cubbie help', id: 'm3' }));
    expect(got.map((m) => [m.text, m.mentionsBot, m.from, m.chatId, m.isGroup])).toEqual([
      ['@cubbie what is DNA', true, 's_ana', 'chan1', true],
      ['lol', false, 's_ana', 'chan1', true],
      ['hey cubbie help', true, 's_ana', 'chan1', true],
    ]);
  });

  it('DMs always mention and use dm:<student>; unknown users get s_<last4>', async () => {
    const { client, got } = await setup();
    await client.emit(msg({ guildId: null, author: { id: '101', bot: false } }));
    await client.emit(msg({ guildId: null, author: { id: '99887766', bot: false }, id: 'x' }));
    expect(got[0]).toMatchObject({ chatId: 'dm:s_ben', isGroup: false, mentionsBot: true });
    expect(got[1]!.from).toBe('s_7766');
  });

  it('ignores bots and its own messages', async () => {
    const { client, got } = await setup();
    await client.emit(msg({ author: { id: '5', bot: true } }));
    await client.emit(msg({ author: { id: BOT, bot: false } }));
    expect(got).toHaveLength(0);
  });

  it('downloads attachments to local paths; oversize or failing ones are dropped', async () => {
    const fetchOk = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('bad') ? new Response('no', { status: 404 }) : new Response('PNGDATA'),
    ) as unknown as typeof fetch;
    const { client, got } = await setup({ fetch: fetchOk, maxAttachmentBytes: 100 });
    await client.emit(
      msg({
        content: 'pic',
        attachments: [
          { url: 'https://x/ok.png', contentType: 'image/png', size: 7, name: 'ok.png' },
          { url: 'https://x/big.png', contentType: 'image/png', size: 1000, name: 'big.png' },
          { url: 'https://x/bad.png', contentType: 'image/png', size: 7, name: 'bad.png' },
        ],
      }),
    );
    await vi.waitFor(() => expect(got).toHaveLength(1)); // disk writes outlast the fake emit's 5 ms pause
    expect(got[0]!.attachments).toHaveLength(1);
    expect(got[0]!.attachments[0]).toMatchObject({ mime: 'image/png' });
    expect(got[0]!.attachments[0]!.path.startsWith('/')).toBe(true);
  });

  it('sends to channels and DMs with pings disabled; persona text untouched', async () => {
    const { t, sent } = await setup();
    await t.send({ chatId: 'chan1', text: 'hi @everyone' });
    await t.send({ chatId: t.dmChatId('s_cam'), text: 'psst' });
    expect(sent[0]).toEqual({
      target: 'ch:chan1',
      o: { content: 'hi @everyone', allowedMentions: { parse: [] } },
    });
    expect(sent[1]!.target).toBe('user:102');
    expect(sent[1]!.o.allowedMentions).toEqual({ parse: [] });
  });

  it('validates attachment paths and uploads files with the last chunk', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'dc-')), 'a.png');
    writeFileSync(f, 'x');
    const { t, sent } = await setup();
    await expect(
      t.send({ chatId: 'chan1', attachments: [{ path: 'rel.png', mime: 'image/png' }] }),
    ).rejects.toThrow(/absolute/);
    const { t: t2 } = await setup({ fileExists: () => false });
    await expect(
      t2.send({ chatId: 'chan1', attachments: [{ path: '/nope.png', mime: 'image/png' }] }),
    ).rejects.toThrow(/not found/);
    await t.send({
      chatId: 'chan1',
      text: 'a'.repeat(2500),
      attachments: [{ path: f, mime: 'image/png' }],
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]!.o.files).toBeUndefined();
    expect(sent[1]!.o.files).toEqual([f]);
  });

  it('missing token throws a clear error without leaking; double start rejects; stop destroys', async () => {
    const { client } = fakeClient();
    const bare = createDiscordTransport({ roster, client });
    const saved = process.env.DISCORD_TOKEN;
    delete process.env.DISCORD_TOKEN;
    await expect(bare.start(() => {})).rejects.toThrow(/DISCORD_TOKEN is not set/);
    if (saved) process.env.DISCORD_TOKEN = saved;
    const { t, client: c2 } = await setup();
    await expect(t.start(() => {})).rejects.toThrow(/already started/);
    await t.stop();
    expect(c2.destroyed).toBe(true);
  });
});

describe('chunkText', () => {
  it('keeps short text whole and exact-boundary text in one chunk', () => {
    expect(chunkText('hi')).toEqual(['hi']);
    expect(chunkText('a'.repeat(2000))).toHaveLength(1);
    expect(chunkText('a'.repeat(2001))).toHaveLength(2);
  });
  it('splits on newlines and spaces first, long words hard-cut, nothing lost', () => {
    const text = `${'word '.repeat(450)}\n${'x'.repeat(5000)}`;
    const parts = chunkText(text);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    expect(parts.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });
  it('does not split surrogate pairs', () => {
    const parts = chunkText('\u{1F43B}'.repeat(1500));
    for (const p of parts) expect(p).toBe(Array.from(p).join('')); // no lone surrogates
    expect(parts.join('')).toBe('\u{1F43B}'.repeat(1500));
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
  });
});
