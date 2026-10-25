import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { InboundMessage, OutboundMessage, StudentId } from '@squad/core';
import { detectMention } from '../mention';
import { nullLogger } from '../log';
import type { Logger, Roster, Transport } from '../types';
import { resolveStudent, SendLimiter, studentById } from './common';

/** Minimal slices of discord.js we use, so tests inject a fake client. */
export interface DiscordMessageLike {
  id: string;
  content: string;
  author: { id: string; bot: boolean };
  channelId: string;
  guildId?: string | null;
  createdTimestamp: number;
  mentions: { has(userId: string): boolean };
  attachments: Iterable<{
    url: string;
    contentType?: string | null;
    size: number;
    name?: string | null;
  }>;
  reference?: { messageId?: string | null } | null;
}
export interface DiscordChannelLike {
  send(o: {
    content?: string;
    files?: string[];
    allowedMentions?: { parse: string[] };
  }): Promise<unknown>;
}
export interface DiscordClientLike {
  user: { id: string } | null;
  on(ev: 'messageCreate', fn: (m: DiscordMessageLike) => void): unknown;
  once?(ev: 'clientReady' | 'ready', fn: () => void): unknown;
  login(token: string): Promise<unknown>;
  destroy(): Promise<void> | void;
  channels: { fetch(id: string): Promise<DiscordChannelLike | null> };
  users: { fetch(id: string): Promise<DiscordChannelLike> };
}

export interface DiscordTransportOptions {
  roster: Roster;
  client?: DiscordClientLike;
  token?: string;
  log?: Logger;
  sendLimiter?: SendLimiter;
  fetch?: typeof fetch;
  maxAttachmentBytes?: number;
  fileExists?: (p: string) => boolean;
}

export const DISCORD_MAX = 2000;

/** Split on newline, then space, then hard-cut at a code point boundary. Never exceeds `max` UTF-16 units. */
export function chunkText(text: string, max = DISCORD_MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.3) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.3) {
      cut = max;
      const c = rest.charCodeAt(cut - 1);
      if (c >= 0xd800 && c <= 0xdbff) cut -= 1; // do not split a surrogate pair
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[ \n]/, '');
  }
  if (rest.length > 0 || out.length === 0) out.push(rest);
  return out;
}

async function realClient(): Promise<DiscordClientLike> {
  const d = await import('discord.js');
  return new d.Client({
    intents: [
      d.GatewayIntentBits.Guilds,
      d.GatewayIntentBits.GuildMessages,
      d.GatewayIntentBits.DirectMessages,
      d.GatewayIntentBits.MessageContent,
    ],
    partials: [d.Partials.Channel],
  }) as unknown as DiscordClientLike;
}

export function createDiscordTransport(opts: DiscordTransportOptions): Transport {
  const log = opts.log ?? nullLogger;
  const limiter = opts.sendLimiter ?? new SendLimiter(1000);
  const doFetch = opts.fetch ?? globalThis.fetch;
  const maxBytes = opts.maxAttachmentBytes ?? 20 * 1024 * 1024;
  const exists = opts.fileExists ?? existsSync;
  const roster = opts.roster;
  let client: DiscordClientLike | undefined;
  let started = false;

  const discordHandle = (id: string) => `discord:${id}`;

  async function download(url: string, mime: string, name: string): Promise<string | undefined> {
    try {
      const res = await doFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error('attachment too large');
      const dir = await mkdtemp(join(tmpdir(), 'squad-discord-'));
      const path = join(dir, name.replace(/[^\w.-]/g, '_') || 'file');
      await writeFile(path, buf);
      void mime;
      return path;
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'discord attachment dropped');
      return undefined;
    }
  }

  async function normalize(
    m: DiscordMessageLike,
    botId: string,
  ): Promise<InboundMessage | undefined> {
    if (m.author.bot || m.author.id === botId) return undefined;
    const isGroup = !!m.guildId;
    const from = resolveStudent(roster, discordHandle(m.author.id));
    const real = m.mentions.has(botId);
    const text = m.content
      .replaceAll(`<@${botId}>`, '@cubbie')
      .replaceAll(`<@!${botId}>`, '@cubbie');
    const attachments: InboundMessage['attachments'] = [];
    for (const a of m.attachments) {
      if (a.size > maxBytes) {
        log.warn({ size: a.size }, 'discord attachment too large, dropped');
        continue;
      }
      const mime = a.contentType ?? 'application/octet-stream';
      const path = await download(a.url, mime, a.name ?? 'file');
      if (path) attachments.push({ path, mime });
    }
    if (!text && attachments.length === 0) return undefined;
    return {
      chatId: isGroup ? m.channelId : `dm:${from}`,
      isGroup,
      from,
      text,
      attachments,
      mentionsBot: !isGroup || real || detectMention(text, isGroup),
      ts: m.createdTimestamp,
      ...(m.reference?.messageId ? { replyTo: m.reference.messageId } : {}),
    };
  }

  function userIdFor(student: StudentId): string {
    const h = studentById(roster, student)?.handle ?? '';
    if (h.startsWith('discord:')) return h.slice('discord:'.length);
    if (/^s_\d+$/.test(student)) return student.slice(2); // unknown sender: id tail only; best effort
    throw new Error(`no discord:<userId> handle for ${student}; add it to fixtures/students.json`);
  }

  async function sendOnce(o: OutboundMessage): Promise<void> {
    if (!client) throw new Error('discord transport not started');
    const files = (o.attachments ?? []).map((a) => a.path);
    for (const p of files) {
      if (!isAbsolute(p)) throw new Error(`attachment path must be absolute: ${p}`);
      if (!exists(p)) throw new Error(`attachment not found: ${p}`);
    }
    const target = o.chatId.startsWith('dm:')
      ? await client.users.fetch(userIdFor(o.chatId.slice(3)))
      : await client.channels.fetch(o.chatId);
    if (!target) throw new Error(`unknown discord channel ${o.chatId}`);
    const chunks = o.text ? chunkText(o.text) : [''];
    for (let i = 0; i < chunks.length; i++) {
      const last = i === chunks.length - 1;
      await target.send({
        ...(chunks[i] ? { content: chunks[i] } : {}),
        ...(last && files.length ? { files } : {}),
        allowedMentions: { parse: [] },
      });
    }
  }

  return {
    name: 'discord',
    dmChatId: (s) => `dm:${s}`,
    async start(onMsg) {
      if (started) throw new Error('discord transport already started');
      const token = opts.token ?? process.env.DISCORD_TOKEN;
      if (!token) throw new Error('DISCORD_TOKEN is not set (see apps/bot/DISCORD.md)');
      started = true;
      try {
        client = opts.client ?? (await realClient());
        const c = client;
        c.on('messageCreate', (m) => {
          const botId = c.user?.id ?? '';
          normalize(m, botId)
            .then((inb) => (inb ? onMsg(inb) : undefined))
            .catch((e: Error) => log.error({ err: e.message }, 'discord inbound failed'));
        });
        const ready = c.once
          ? new Promise<void>((resolve, reject) => {
              const t = setTimeout(() => reject(new Error('discord ready timeout (30s)')), 30_000);
              const done = () => {
                clearTimeout(t);
                resolve();
              };
              c.once!('clientReady', done);
              c.once!('ready', done);
            })
          : Promise.resolve();
        await c.login(token);
        await ready;
        log.info({ user: c.user?.id }, 'discord ready');
      } catch (e) {
        started = false;
        throw e;
      }
    },
    async stop() {
      started = false;
      await client?.destroy();
      client = undefined;
    },
    async send(o) {
      if (!o.text && !(o.attachments && o.attachments.length)) throw new Error('nothing to send');
      await limiter.run(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            await sendOnce(o);
            break;
          } catch (e) {
            const msg = (e as Error).message;
            log.warn({ chatId: o.chatId, attempt, err: msg }, 'discord send failed');
            if (attempt >= 2 || /absolute|not found/.test(msg)) throw e;
          }
        }
      });
    },
  };
}
