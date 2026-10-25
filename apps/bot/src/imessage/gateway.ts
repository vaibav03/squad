import { SendLimiter } from '../transports/common';
import type { IMessageMessageLike, IMessageSdkLike } from '../transports/imessage';
import { nullLogger } from '../log';
import type { Logger } from '../types';
import type { IMessageConfig } from './config';
import { createSafety, senderOf, type DropReason, type Safety } from './safety';
import { splitMessage } from './text';

export type SendOutcome =
  | 'sent'
  | 'dry_run'
  | 'disabled'
  | 'chat_not_allowed'
  | 'handle_not_allowed'
  | 'rate_limited'
  | 'failed';

/** A normalized inbound text, after every safety check passed. */
export interface GatewayInbound {
  /** Apple's message guid: the dedupe key. */
  guid: string;
  /** Chat guid: group chats are `iMessage;+;chat...`; for a 1:1 the guid embeds the handle. */
  chatGuid: string;
  isGroup: boolean;
  /** Sender handle (phone E.164 or Apple ID email). Held in memory only. */
  sender: string;
  text: string;
  ts: number;
}

export interface OutboxEntry {
  to: string;
  kind: 'group' | 'dm';
  text: string;
  dryRun: boolean;
  at: number;
}

export interface IMessageGateway {
  readonly safety: Safety;
  readonly config: IMessageConfig;
  /** Everything handed to Apple (or, in dry-run, everything that would have been). Bounded. */
  readonly outbox: readonly OutboxEntry[];
  /** Drops by reason, for the runbook and tests. */
  readonly drops: Readonly<Record<string, number>>;
  start(onInbound: (m: GatewayInbound) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
  /** Text to a group chat guid or a 1:1 handle; long text is split. Never throws. */
  send(to: string, text: string): Promise<SendOutcome>;
  /** The raw SDK-shaped send used by the standalone transport (text and/or attachments). */
  sendRaw(r: { to: string; text?: string; attachments?: readonly string[] }): Promise<void>;
  /** Safety-filtered raw watcher for the standalone transport. */
  watchRaw(events: Parameters<IMessageSdkLike['startWatching']>[0]): Promise<void>;
  /** An SDK-shaped view with every check applied: hand it to `createIMessageTransport({ sdk })`. */
  guardedSdk(): IMessageSdkLike;
}

export interface GatewayOptions {
  config: IMessageConfig;
  sdk?: IMessageSdkLike;
  log?: Logger;
  now?: () => number;
  seen?: (guid: string) => boolean;
  /** Spacing between two real sends (default 1000 ms). */
  minGapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Max characters of one message part (default 900). */
  maxLen?: number;
}

async function realSdk(): Promise<IMessageSdkLike> {
  const mod = await import('@photon-ai/imessage-kit');
  return new mod.IMessageSDK() as unknown as IMessageSdkLike;
}

const OUTBOX_MAX = 200;

export function createIMessageGateway(o: GatewayOptions): IMessageGateway {
  const log = o.log ?? nullLogger;
  const now = o.now ?? Date.now;
  const cfg = o.config;
  const safety = createSafety({
    config: cfg,
    log,
    now,
    ...(o.seen ? { seen: o.seen } : {}),
  });
  const limiter = new SendLimiter(o.minGapMs ?? 1000, now, o.sleep);
  const outbox: OutboxEntry[] = [];
  const drops: Record<string, number> = {};
  let sdkP: Promise<IMessageSdkLike> | undefined;
  const getSdk = () => (sdkP ??= o.sdk ? Promise.resolve(o.sdk) : realSdk());
  let started = false;
  const drop = (reason: DropReason) => {
    drops[reason] = (drops[reason] ?? 0) + 1;
  };
  const record = (e: OutboxEntry) => {
    outbox.push(e);
    if (outbox.length > OUTBOX_MAX) outbox.shift();
  };
  // logs carry lengths and the chat kind, never the text or the handle

  async function deliver(r: { to: string; text?: string; attachments?: readonly string[] }) {
    const verdict = safety.admitOutbound(r.to);
    if (!verdict.ok) {
      drops[`out_${verdict.reason}`] = (drops[`out_${verdict.reason}`] ?? 0) + 1;
      return verdict.reason;
    }
    if (!safety.consume(r.to)) {
      drops.out_rate_limited = (drops.out_rate_limited ?? 0) + 1;
      log.warn({ kind: verdict.kind }, 'imessage: outbound rate limit, message dropped');
      return 'rate_limited' as const;
    }
    const text = r.text ?? '';
    if (cfg.dryRun) {
      record({ to: r.to, kind: verdict.kind, text, dryRun: true, at: now() });
      log.info({ kind: verdict.kind, len: text.length }, 'imessage DRY RUN: would send');
      if (text) safety.noteSent(r.to, text);
      return 'dry_run' as const;
    }
    const sdk = await getSdk();
    try {
      await limiter.run(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            await sdk.send(r);
            break;
          } catch (e) {
            log.warn(
              { kind: verdict.kind, attempt, err: (e as Error).message },
              'imessage send failed',
            );
            if (attempt >= 2) throw e;
          }
        }
      });
    } catch {
      return 'failed' as const;
    }
    if (text) safety.noteSent(r.to, text);
    record({ to: r.to, kind: verdict.kind, text, dryRun: false, at: now() });
    log.info({ kind: verdict.kind, len: text.length }, 'imessage sent');
    return 'sent' as const;
  }

  const normalize = (m: IMessageMessageLike): GatewayInbound => ({
    guid: m.id,
    chatGuid: m.chatId as string,
    isGroup: m.chatKind ? m.chatKind === 'group' : /;\+;/.test(m.chatId as string),
    sender: senderOf(m),
    text: m.text ?? '',
    ts: m.createdAt.getTime(),
  });

  const gw: IMessageGateway = {
    safety,
    config: cfg,
    outbox,
    drops,
    async start(onInbound) {
      if (started) throw new Error('iMessage gateway already started (one watcher per process)');
      started = true;
      try {
        await gw.watchRaw({
          onIncomingMessage: async (raw) => {
            if (!raw.text) return; // attachments-only messages are not chat text
            try {
              await onInbound(normalize(raw));
            } catch (e) {
              log.error({ err: (e as Error).message }, 'imessage inbound handler failed');
            }
          },
          onError: (e) => log.error({ err: e.message }, 'imessage watcher error'),
        });
      } catch (e) {
        started = false;
        throw e;
      }
    },
    async watchRaw(events) {
      if (!cfg.enabled) {
        log.warn({}, 'imessage: kill switch is on (IMESSAGE_ENABLED is not 1), not watching');
        return;
      }
      const sdk = await getSdk();
      await sdk.startWatching({
        ...events,
        onIncomingMessage: async (raw) => {
          const v = safety.admitInbound(raw);
          if (!v.ok) {
            drop(v.reason);
            return;
          }
          await events.onIncomingMessage?.(raw);
        },
      });
    },
    async stop() {
      started = false;
      if (!sdkP) return;
      const sdk = await getSdk();
      await sdk.stopWatching().catch(() => undefined);
      await sdk.close().catch(() => undefined);
      sdkP = undefined;
    },
    async send(to, text) {
      const parts = splitMessage(text, o.maxLen ?? 900);
      let last: SendOutcome = 'sent';
      for (const p of parts) {
        last = await deliver({ to, text: p });
        if (last !== 'sent' && last !== 'dry_run') break;
      }
      return last;
    },
    async sendRaw(r) {
      const out = await deliver(r);
      if (out === 'failed') throw new Error('imessage send failed');
    },
    guardedSdk() {
      return {
        startWatching: (e) => gw.watchRaw(e),
        stopWatching: async () => {
          if (sdkP) await (await getSdk()).stopWatching();
        },
        send: (r) => gw.sendRaw(r),
        listChats: async (q) => (await getSdk()).listChats(q),
        close: () => gw.stop(),
      };
    },
  };
  return gw;
}
