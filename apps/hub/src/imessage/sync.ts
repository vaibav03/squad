// The stateful half of the iMessage <-> web sync (docs/imessage.md section 8): the outbound queue with retry and
// backoff, delivery state per message, backfill from a per-chat cursor, and inbound attachment intake.
import { readFileSync, statSync } from 'node:fs';
import type { ChatAttachment, SkippedAttachment } from '@squad/core';
import type { GatewayAttachment, IMessageGateway } from '@squad/bot';
import type { HubDeps } from '../types';
import type { ImessageStore, OutRow } from './store';
import {
  aggregateDelivery,
  ATTACH_MAX_PER_MESSAGE,
  backoffFor,
  classifyAttachment,
  MAX_ATTEMPTS,
  OUT_EXPIRE_MS,
  RATE_RETRY_MS,
} from './sync-rules';

/** How far before the cursor a backfill looks: Apple can deliver a message after a newer one. */
export const BACKFILL_OVERLAP_MS = 5 * 60_000;
/** A backfilled message older than this is stored for the record but not sent to the bot to answer. */
export const BACKFILL_ANSWER_MAX_MS = 6 * 3_600_000;
const DRAIN_EVERY_MS = 1_000;
const BACKFILL_EVERY_MS = 60_000;

export interface SyncStats {
  duplicates: number;
  echoes: number;
  late: number;
  mirrored: number;
  withheld: number;
  sent: number;
  failed: number;
  retried: number;
}

export interface SyncStatus {
  /** ok | degraded | disabled | dry_run */
  transport: string;
  queued: number;
  failed: number;
  watcherDown: boolean;
  backfill: boolean;
  receipts: boolean;
}

export interface OutPart {
  text?: string | null;
  attachments?: string[];
}

export interface ImessageSync {
  readonly stats: SyncStats;
  /** Queue the parts of one hub message for one target (a group chat guid or `dm:<userId>`). Idempotent. */
  queue(messageId: string, target: string, parts: readonly OutPart[]): void;
  /** Try every due queued row now (retries respect their backoff). Serialised. */
  drain(): Promise<void>;
  /** Failed rows of this message go back to the queue with a fresh attempt budget. Returns how many. */
  retry(messageId: string): number;
  /** Recompute and publish the delivery state of a message. */
  refresh(messageId: string): void;
  /** Fetch what bound chats (and known 1:1s) missed since their cursors. */
  backfillAll(): Promise<{ chats: number; messages: number }>;
  status(): Promise<SyncStatus>;
  /** Copy the files of an inbound message into the hub under the caps; the rest become honest placeholders. */
  intakeAttachments(
    atts: readonly GatewayAttachment[],
    save: (bytes: Uint8Array, mime: string, name?: string) => ChatAttachment | undefined,
  ): { attachments: ChatAttachment[]; skipped: SkippedAttachment[] };
  start(): void;
  stop(): void;
}

export interface SyncOptions {
  deps: HubDeps;
  gateway: IMessageGateway;
  store: ImessageStore;
  now?: () => number;
  /** group chat guid -> itself; `dm:<userId>` -> the raw handle if known this process, else undefined */
  resolveTo(target: string): string | undefined;
  /** 1:1 chats worth backfilling: their cursor key and chat guid (shape unverified on real Apple). */
  dmChats(): { threadKey: string; chatGuid: string }[];
  timers?: boolean;
}

export function createImessageSync(o: SyncOptions): ImessageSync {
  const { deps, gateway, store } = o;
  const now = o.now ?? deps.now;
  const log = deps.log;
  const stats: SyncStats = {
    duplicates: 0,
    echoes: 0,
    late: 0,
    mirrored: 0,
    withheld: 0,
    sent: 0,
    failed: 0,
    retried: 0,
  };
  let lock: Promise<unknown> = Promise.resolve();
  let drainTimer: ReturnType<typeof setInterval> | undefined;
  let backfillTimer: ReturnType<typeof setInterval> | undefined;
  const degraded = () => gateway.health().state === 'degraded';

  function refresh(messageId: string) {
    const d = aggregateDelivery(store.outOfMessage(messageId), { degraded: degraded(), now: now() });
    if (d) deps.chat.annotate(messageId, { deliveryState: d });
  }

  async function sendRow(row: OutRow): Promise<void> {
    const t = now();
    if (t - row.createdAt > OUT_EXPIRE_MS) {
      store.patchOut(row.id, { state: 'failed', reason: 'expired' }, t);
      stats.failed++;
      return;
    }
    const to = row.target.startsWith('dm:') ? o.resolveTo(row.target) : row.target;
    if (!to) {
      store.patchOut(row.id, { state: 'failed', reason: 'no_handle' }, t);
      stats.failed++;
      return;
    }
    const res = await gateway.sendOne({
      to,
      ...(row.text ? { text: row.text } : {}),
      ...(row.attachments.length ? { attachments: row.attachments } : {}),
    });
    const at = now();
    switch (res.outcome) {
      case 'sent': {
        store.patchOut(row.id, { state: 'sent', extId: res.guid ?? null, clearPayload: true }, at);
        if (res.guid) store.recordOutXref(res.guid, row.target, row.messageId, at);
        stats.sent++;
        return;
      }
      case 'dry_run':
        store.patchOut(row.id, { state: 'dry_run', clearPayload: true }, at);
        return;
      case 'disabled':
        store.patchOut(row.id, { state: 'failed', reason: 'kill_switch' }, at);
        stats.failed++;
        return;
      case 'chat_not_allowed':
      case 'handle_not_allowed':
        store.patchOut(row.id, { state: 'failed', reason: res.outcome }, at);
        stats.failed++;
        return;
      case 'rate_limited':
        // not a failure: the per-chat outbound limit; try again shortly (the expiry above still bounds it)
        store.patchOut(row.id, { nextAt: at + RATE_RETRY_MS }, at);
        return;
      default: {
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          store.patchOut(row.id, { state: 'failed', reason: 'transport_error', attempts }, at);
          stats.failed++;
        } else {
          store.patchOut(row.id, { attempts, nextAt: at + backoffFor(attempts) }, at);
          stats.retried++;
        }
      }
    }
  }

  async function drainOnce() {
    const touched = new Set<string>();
    const tried = new Set<number>();
    // rows of one target go strictly in order: a row never overtakes an earlier queued one
    for (;;) {
      const next = store
        .dueOut(now(), 100)
        .find((r) => !tried.has(r.id) && !store.hasEarlierQueued(r.id, r.target));
      if (!next) break;
      tried.add(next.id);
      touched.add(next.messageId);
      await sendRow(next);
    }
    for (const m of touched) refresh(m);
  }

  const syncOnReceipt = (r: { guid: string; state: 'delivered' | 'failed'; reason?: string }) => {
    const row = store.outByExt(r.guid);
    if (!row) return;
    store.patchOut(
      row.id,
      r.state === 'delivered'
        ? { state: 'delivered' }
        : { state: 'failed', reason: 'receipt_failed' },
      now(),
    );
    refresh(row.messageId);
  };
  gateway.onReceipt(syncOnReceipt);

  const sync: ImessageSync = {
    stats,
    queue(messageId, target, parts) {
      parts.forEach((p, i) =>
        store.enqueueOut({
          messageId,
          target,
          part: i,
          text: p.text ?? null,
          ...(p.attachments?.length ? { attachments: p.attachments } : {}),
          at: now(),
        }),
      );
      stats.mirrored++;
      refresh(messageId);
    },
    drain() {
      lock = lock.then(drainOnce).catch((e: Error) => log.error('imessage: drain failed', { err: e.name }));
      return lock as Promise<void>;
    },
    retry(messageId) {
      let n = 0;
      for (const r of store.outOfMessage(messageId))
        if (r.state === 'failed') {
          store.patchOut(r.id, { state: 'queued', reason: null, attempts: 0, nextAt: now() }, now());
          n++;
        }
      if (n) refresh(messageId);
      return n;
    },
    refresh,
    async backfillAll() {
      const caps = await gateway.capabilities().catch(() => undefined);
      if (!caps?.backfill) return { chats: 0, messages: 0 };
      const chats: { key: string; guid: string; since: number }[] = [];
      for (const b of deps.imessage.allBindings()) {
        const cur = store.cursor(b.chatGuid);
        chats.push({
          key: b.chatGuid,
          guid: b.chatGuid,
          // never import history from before the chat was bound
          since: Math.max(b.boundAt, (cur?.lastTs ?? b.boundAt) - BACKFILL_OVERLAP_MS),
        });
      }
      for (const d of o.dmChats()) {
        const cur = store.cursor(d.threadKey);
        if (cur) chats.push({ key: d.threadKey, guid: d.chatGuid, since: cur.lastTs - BACKFILL_OVERLAP_MS });
      }
      let messages = 0;
      for (const c of chats) messages += await gateway.backfill(c.guid, c.since);
      if (messages) log.info('imessage: backfill merged', { chats: chats.length, messages });
      return { chats: chats.length, messages };
    },
    async status() {
      const h = gateway.health();
      const caps = await gateway.capabilities().catch(() => undefined);
      const c = store.outCounts();
      return {
        transport: h.state,
        queued: c.queued,
        failed: c.failed,
        watcherDown: h.watcherDown,
        backfill: caps?.backfill ?? false,
        receipts: caps?.receipts ?? false,
      };
    },
    intakeAttachments(atts, save) {
      const attachments: ChatAttachment[] = [];
      const skipped: SkippedAttachment[] = [];
      for (const a of atts) {
        const base = { mime: a.mime, ...(a.name ? { name: a.name.replace(/[^\w .-]/g, '_').slice(0, 80) } : {}) };
        if (attachments.length >= ATTACH_MAX_PER_MESSAGE) {
          skipped.push({ ...base, reason: 'too_large' });
          continue;
        }
        try {
          if (!a.localPath) throw new Error('no path');
          const size = statSync(a.localPath).size;
          // read only what the caps allow: the size check comes first, the type check needs the head
          const early = classifyAttachment(a.mime, size, new Uint8Array(0));
          if (!early.ok && early.reason !== 'unsupported_type') {
            skipped.push({ ...base, reason: early.reason });
            continue;
          }
          const bytes = new Uint8Array(readFileSync(a.localPath));
          const v = classifyAttachment(a.mime, bytes.byteLength, bytes);
          if (!v.ok) {
            skipped.push({ ...base, reason: v.reason });
            continue;
          }
          const saved = save(bytes, v.mime, a.name);
          if (saved) attachments.push(saved);
          else skipped.push({ ...base, reason: 'unavailable' });
        } catch {
          skipped.push({ ...base, reason: 'unavailable' });
        }
      }
      return { attachments, skipped };
    },
    start() {
      if (o.timers === false || drainTimer) return;
      drainTimer = setInterval(() => void sync.drain(), DRAIN_EVERY_MS);
      backfillTimer = setInterval(() => void sync.backfillAll(), BACKFILL_EVERY_MS);
      drainTimer.unref?.();
      backfillTimer.unref?.();
    },
    stop() {
      if (drainTimer) clearInterval(drainTimer);
      if (backfillTimer) clearInterval(backfillTimer);
      drainTimer = backfillTimer = undefined;
    },
  };
  return sync;
}
