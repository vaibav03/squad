import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ChatId, InboundMessage, OutboundMessage, StudentId } from '@squad/core';
import { detectMention } from '../mention';
import { nullLogger } from '../log';
import type { Logger, Roster, Transport } from '../types';
import { resolveStudent, SendLimiter, studentById } from './common';

/** The slice of @photon-ai/imessage-kit's IMessageSDK we use (typings verified against v3.0.0). */
export interface IMessageAttachmentLike {
  localPath: string | null;
  mimeType: string;
  fileName?: string | null;
}
export interface IMessageMessageLike {
  id: string;
  chatId: string | null;
  chatKind?: 'dm' | 'group' | 'unknown';
  participant: string | null;
  text: string | null;
  kind?: string;
  isFromMe: boolean;
  createdAt: Date;
  replyToMessageId?: string | null;
  reaction?: unknown | null;
  attachments: readonly IMessageAttachmentLike[];
}
export interface IMessageSdkLike {
  startWatching(events: {
    onIncomingMessage?: (m: IMessageMessageLike) => void | Promise<void>;
    onError?: (e: Error) => void;
  }): Promise<void>;
  stopWatching(): Promise<void>;
  send(r: { to: string; text?: string; attachments?: readonly string[] }): Promise<void>;
  listChats(q?: {
    kind?: 'group' | 'dm';
    limit?: number;
  }): Promise<readonly { chatId: string; name: string | null; kind: string }[]>;
  close(): Promise<void>;
}

export interface IMessageTransportOptions {
  roster: Roster;
  sdk?: IMessageSdkLike;
  log?: Logger;
  sendLimiter?: SendLimiter;
  now?: () => number;
  fileExists?: (p: string) => boolean;
}

const ECHO_WINDOW_MS = 60_000;
const MIME_FALLBACK = 'application/octet-stream';

export type IMessageTransport = Transport & {
  /** exposed for the verification script and tests */
  sdk(): Promise<IMessageSdkLike>;
  normalize(m: IMessageMessageLike): InboundMessage | undefined;
};

async function realSdk(): Promise<IMessageSdkLike> {
  const mod = await import('@photon-ai/imessage-kit');
  return new mod.IMessageSDK() as unknown as IMessageSdkLike;
}

export function createIMessageTransport(opts: IMessageTransportOptions): IMessageTransport {
  if (!opts.sdk && process.platform !== 'darwin') {
    throw new Error(
      'The iMessage transport only runs on macOS (Messages.app). Use TRANSPORT=discord or cli.',
    );
  }
  const log = opts.log ?? nullLogger;
  const now = opts.now ?? Date.now;
  const limiter = opts.sendLimiter ?? new SendLimiter(1000, now);
  const exists = opts.fileExists ?? existsSync;
  const roster = opts.roster;
  let sdkP: Promise<IMessageSdkLike> | undefined;
  const getSdk = () => (sdkP ??= opts.sdk ? Promise.resolve(opts.sdk) : realSdk());
  let started = false;
  const realDmChat = new Map<StudentId, string>(); // learned from inbound DMs
  const recentSent = new Map<string, number>();

  const dmId = (s: StudentId): ChatId => `dm:${s}`;

  function target(chatId: ChatId): string {
    if (!chatId.startsWith('dm:')) return chatId;
    const id = chatId.slice(3);
    const handle = studentById(roster, id)?.handle;
    if (handle && /^(\+?\d[\d\s().-]{5,}|[^@\s]+@[^@\s]+)$/.test(handle)) return handle;
    const learned = realDmChat.get(id);
    if (learned) return learned;
    throw new Error(
      `no handle or known chat for DM target ${id}; add it to fixtures/students.json`,
    );
  }

  function normalize(m: IMessageMessageLike): InboundMessage | undefined {
    if (m.isFromMe) return undefined;
    if (m.reaction) return undefined; // tapbacks are not messages
    if (m.kind && m.kind !== 'text') return undefined;
    if (!m.chatId) return undefined; // WAL race: chat unknown
    const text = m.text ?? '';
    const attachments = m.attachments
      .filter((a) => a.localPath)
      .map((a) => ({ path: a.localPath!, mime: a.mimeType || MIME_FALLBACK }));
    if (!text && attachments.length === 0) return undefined;
    const isGroup = m.chatKind ? m.chatKind === 'group' : /;\+;/.test(m.chatId);
    const from = resolveStudent(roster, m.participant ?? m.chatId);
    const sentAt = recentSent.get(text);
    if (sentAt !== undefined && now() - sentAt < ECHO_WINDOW_MS && !studentById(roster, from)) {
      return undefined; // echo of our own send from an unknown sender (chat.db lag)
    }
    if (!isGroup) realDmChat.set(from, m.chatId);
    return {
      chatId: isGroup ? m.chatId : dmId(from),
      isGroup,
      from,
      text,
      attachments,
      mentionsBot: detectMention(text, isGroup),
      ts: m.createdAt.getTime(),
      ...(m.replyToMessageId ? { replyTo: m.replyToMessageId } : {}),
    };
  }

  return {
    name: 'imessage',
    sdk: getSdk,
    normalize,
    dmChatId: dmId,
    async start(onMsg) {
      if (started) throw new Error('iMessage transport already started (one watcher per process)');
      started = true;
      const sdk = await getSdk();
      try {
        await sdk.startWatching({
          onIncomingMessage: async (raw) => {
            const m = normalize(raw);
            if (!m) return;
            log.info({ chatId: m.chatId, from: m.from, len: m.text.length }, 'imessage inbound');
            try {
              await onMsg(m);
            } catch (e) {
              log.error({ err: (e as Error).message }, 'inbound handler failed');
            }
          },
          onError: (e) => log.error({ err: e.message }, 'imessage watcher error'),
        });
      } catch (e) {
        started = false;
        throw e;
      }
    },
    async stop() {
      if (!started && !sdkP) return;
      started = false;
      const sdk = await getSdk();
      await sdk.stopWatching().catch(() => undefined);
      await sdk.close().catch(() => undefined);
      sdkP = undefined;
    },
    async send(o: OutboundMessage) {
      const paths = (o.attachments ?? []).map((a) => a.path);
      for (const p of paths) {
        if (!isAbsolute(p)) throw new Error(`attachment path must be absolute: ${p}`);
        if (!exists(p)) throw new Error(`attachment not found: ${p}`);
      }
      if (!o.text && paths.length === 0) throw new Error('nothing to send');
      const to = target(o.chatId);
      const sdk = await getSdk();
      await limiter.run(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            await sdk.send({
              to,
              ...(o.text ? { text: o.text } : {}),
              ...(paths.length ? { attachments: paths } : {}),
            });
            break;
          } catch (e) {
            log.warn(
              { chatId: o.chatId, attempt, err: (e as Error).message },
              'imessage send failed',
            );
            if (attempt >= 2) throw e;
          }
        }
        if (o.text) recentSent.set(o.text, now());
        log.info(
          { chatId: o.chatId, len: o.text?.length ?? 0, attachments: paths.length },
          'imessage sent',
        );
      });
    },
  };
}
