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
  /** Files Apple reports on the message (local paths on this Mac). Empty for plain text. */
  attachments: GatewayAttachment[];
  /** true when this arrived through backfill rather than the live watcher. */
  late?: boolean;
}

export interface GatewayAttachment {
  localPath: string | null;
  mime: string;
  name?: string;
}

/** What `sendOne` reports. `sent` only when the transport confirmed. */
export interface SendDetail {
  outcome: SendOutcome;
  /** the transport's guid for the new message, when it reports one */
  guid?: string;
  error?: string;
}

export type TransportHealth = 'ok' | 'degraded' | 'disabled' | 'dry_run';
export interface GatewayHealth {
  state: TransportHealth;
  consecutiveFailures: number;
  lastOkAt?: number;
  lastErrorAt?: number;
  /** the watcher reported an error and has not delivered since */
  watcherDown: boolean;
}
export interface GatewayCapabilities {
  attachments: boolean;
  receipts: boolean;
  backfill: boolean;
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
  /** One message (text and/or files), no splitting, with a detailed outcome. Never throws. */
  sendOne(r: { to: string; text?: string; attachments?: readonly string[] }): Promise<SendDetail>;
  health(): GatewayHealth;
  capabilities(): Promise<GatewayCapabilities>;
  /** Delivery receipts from transports that have them (matched by the guid `sendOne` returned). */
  onReceipt(
    fn: (r: {
      guid: string;
      state: 'sent' | 'delivered' | 'read' | 'failed';
      reason?: string;
    }) => void,
  ): void;
  /**
   * Fetch what a chat received since `since` and feed it to the inbound handler, flagged `late`. Safety, dedupe and
   * allowlists apply. Returns how many messages were handed on (0 when the transport cannot backfill).
   */
  backfill(chatGuid: string, since: number, limit?: number): Promise<number>;
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

  let consecutiveFailures = 0;
  let lastOkAt: number | undefined;
  let lastErrorAt: number | undefined;
  let watcherDown = false;
  const receiptFns: Parameters<IMessageGateway['onReceipt']>[0][] = [];
  let inbound: ((m: GatewayInbound) => void | Promise<void>) | undefined;
  const DEGRADED_AFTER = 3;

  async function deliver(r: {
    to: string;
    text?: string;
    attachments?: readonly string[];
  }): Promise<SendDetail> {
    const verdict = safety.admitOutbound(r.to);
    if (!verdict.ok) {
      drops[`out_${verdict.reason}`] = (drops[`out_${verdict.reason}`] ?? 0) + 1;
      return { outcome: verdict.reason };
    }
    if (!safety.consume(r.to)) {
      drops.out_rate_limited = (drops.out_rate_limited ?? 0) + 1;
      log.warn({ kind: verdict.kind }, 'imessage: outbound rate limit, message dropped');
      return { outcome: 'rate_limited' };
    }
    const text = r.text ?? '';
    if (cfg.dryRun) {
      record({ to: r.to, kind: verdict.kind, text, dryRun: true, at: now() });
      log.info({ kind: verdict.kind, len: text.length }, 'imessage DRY RUN: would send');
      if (text) safety.noteSent(r.to, text);
      return { outcome: 'dry_run' };
    }
    const sdk = await getSdk();
    let guid: string | undefined;
    try {
      await limiter.run(async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            const res = (await sdk.send(r)) as { guid?: string } | undefined;
            if (res && typeof res.guid === 'string') guid = res.guid;
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
    } catch (e) {
      consecutiveFailures++;
      lastErrorAt = now();
      return { outcome: 'failed', error: (e as Error).message.slice(0, 120) };
    }
    consecutiveFailures = 0;
    lastOkAt = now();
    if (text) safety.noteSent(r.to, text);
    record({ to: r.to, kind: verdict.kind, text, dryRun: false, at: now() });
    log.info({ kind: verdict.kind, len: text.length }, 'imessage sent');
    return { outcome: 'sent', ...(guid ? { guid } : {}) };
  }

  const normalize = (m: IMessageMessageLike): GatewayInbound => ({
    guid: m.id,
    chatGuid: m.chatId as string,
    isGroup: m.chatKind ? m.chatKind === 'group' : /;\+;/.test(m.chatId as string),
    sender: senderOf(m),
    text: m.text ?? '',
    ts: m.createdAt.getTime(),
    attachments: (m.attachments ?? []).map((a) => ({
      localPath: a.localPath,
      mime: a.mimeType || 'application/octet-stream',
      ...(a.fileName ? { name: a.fileName } : {}),
    })),
  });

  const gw: IMessageGateway = {
    safety,
    config: cfg,
    outbox,
    drops,
    async start(onInbound) {
      if (started) throw new Error('iMessage gateway already started (one watcher per process)');
      started = true;
      inbound = onInbound;
      try {
        await gw.watchRaw({
          onIncomingMessage: async (raw) => {
            if (!raw.text && !raw.attachments?.length) return; // nothing to show
            try {
              await onInbound(normalize(raw));
            } catch (e) {
              log.error({ err: (e as Error).message }, 'imessage inbound handler failed');
            }
          },
          onError: (e) => {
            watcherDown = true;
            log.error({ err: e.message }, 'imessage watcher error');
          },
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
          watcherDown = false;
          const v = safety.admitInbound(raw);
          if (!v.ok) {
            drop(v.reason);
            return;
          }
          await events.onIncomingMessage?.(raw);
        },
      });
      sdk.watchReceipts?.((r) => {
        for (const fn of receiptFns) fn(r);
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
    sendOne: async (r) => {
      try {
        return await deliver(r);
      } catch (e) {
        consecutiveFailures++;
        lastErrorAt = now();
        return { outcome: 'failed', error: (e as Error).message.slice(0, 120) };
      }
    },
    health() {
      const state: TransportHealth = !cfg.enabled
        ? 'disabled'
        : cfg.dryRun
          ? 'dry_run'
          : consecutiveFailures >= DEGRADED_AFTER || watcherDown
            ? 'degraded'
            : 'ok';
      return {
        state,
        consecutiveFailures,
        watcherDown,
        ...(lastOkAt !== undefined ? { lastOkAt } : {}),
        ...(lastErrorAt !== undefined ? { lastErrorAt } : {}),
      };
    },
    async capabilities() {
      const sdk = await getSdk();
      return {
        attachments: true,
        receipts: typeof sdk.watchReceipts === 'function',
        backfill: typeof sdk.listMessages === 'function',
      };
    },
    onReceipt(fn) {
      receiptFns.push(fn);
    },
    async backfill(chatGuid, since, limit = 200) {
      if (!cfg.enabled || !inbound) return 0;
      const sdk = await getSdk();
      if (!sdk.listMessages) return 0;
      let got: Awaited<ReturnType<NonNullable<typeof sdk.listMessages>>>;
      try {
        got = await sdk.listMessages({ chatId: chatGuid, since: new Date(since), limit });
      } catch (e) {
        log.warn({ err: (e as Error).message }, 'imessage backfill failed');
        return 0;
      }
      watcherDown = false;
      let n = 0;
      const sorted = [...got].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const raw of sorted) {
        if (!raw.text && !raw.attachments?.length) continue;
        const v = safety.admitInbound(raw, { backfill: true });
        if (!v.ok) {
          drop(v.reason);
          continue;
        }
        try {
          await inbound({ ...normalize(raw), late: true });
          n++;
        } catch (e) {
          log.error({ err: (e as Error).message }, 'imessage backfill handler failed');
        }
      }
      return n;
    },
    async send(to, text) {
      const parts = splitMessage(text, o.maxLen ?? 900);
      let last: SendOutcome = 'sent';
      for (const p of parts) {
        last = (await deliver({ to, text: p })).outcome;
        if (last !== 'sent' && last !== 'dry_run') break;
      }
      return last;
    },
    async sendRaw(r) {
      const out = (await deliver(r)).outcome;
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
