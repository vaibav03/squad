// The live Sendblue runtime the webhook routes, status and health read. Created by `attachIMessage` when
// IMESSAGE_PROVIDER=sendblue and every credential is present; absent otherwise (the routes then fail closed).
import { normalizePhone } from '@squad/core';
import type { IMessageConfig, IMessageGateway } from '@squad/bot';
import type { HubDeps } from '../../types';
import type { SendblueClient } from './client';
import type { SendblueConfig } from './config';
import { maskNumber } from './config';
import type { MediaSigner } from './media';
import { DM_PREFIX, groupGuid, type SendblueSdk } from './sdk';
import type { SendblueStore } from './store';
import type { SbMessage } from './webhook-schema';

export interface SendblueRuntime {
  cfg: SendblueConfig;
  sdk: SendblueSdk;
  client: SendblueClient;
  store: SendblueStore;
  media: MediaSigner;
  safety: IMessageConfig;
  gateway: IMessageGateway;
  /** Webhook rejections by reason (counts only, for the runbook and tests). */
  readonly rejected: Readonly<Record<string, number>>;
  noteRejected(code: string): void;
  recordInboundIds(p: SbMessage): void;
  /** Apply a status callback to the delivery state; retries briefly if the send has not been recorded yet. */
  applyReceipt(
    handle: string,
    state: 'queued' | 'sent' | 'delivered' | 'read' | 'failed',
    reason?: string,
  ): void;
}

export function createSendblueRuntime(o: {
  deps: HubDeps;
  cfg: SendblueConfig;
  sdk: SendblueSdk;
  client: SendblueClient;
  store: SendblueStore;
  media: MediaSigner;
  safety: IMessageConfig;
  gateway: IMessageGateway;
  retryMs?: number;
}): SendblueRuntime {
  const { deps, store } = o;
  const rejected: Record<string, number> = {};
  const hashOf = (n: string | null | undefined) => {
    const norm = n ? normalizePhone(n) : undefined;
    return norm
      ? { hash: deps.accounts.hashContact('phone', norm), last4: maskNumber(norm).slice(-4) }
      : { hash: null, last4: null };
  };
  const userOf = (hash: string | null): string | null =>
    hash
      ? ((
          deps.db.prepare('SELECT id FROM acct_users WHERE contact_hash=?').get(hash) as
            { id: string } | undefined
        )?.id ??
        deps.imessage.linkedUser(hash) ??
        null)
      : null;

  const rt: SendblueRuntime = {
    ...o,
    rejected,
    noteRejected(code) {
      rejected[code] = (rejected[code] ?? 0) + 1;
    },
    recordInboundIds(p) {
      const at = deps.now();
      const { hash, last4 } = hashOf(p.from_number);
      const isGroup = !!p.group_id;
      const chatGuid = isGroup ? groupGuid(p.group_id!) : `${DM_PREFIX}${hash ?? 'unknown'}`;
      const binding = isGroup ? deps.imessage.binding(chatGuid) : undefined;
      const uid = userOf(hash);
      const conversation = isGroup
        ? binding
          ? `group:${binding.squadId}`
          : null
        : uid
          ? `dm:${uid}`
          : null;
      if (isGroup) store.upsertId({ kind: 'group', sbId: p.group_id!, chatGuid, conversation, at });
      else
        store.upsertId({
          kind: 'thread',
          sbId: chatGuid,
          chatGuid,
          conversation,
          handleHash: hash,
          last4,
          at,
        });
      store.upsertId({
        kind: 'message',
        sbId: p.message_handle,
        chatGuid,
        conversation,
        messageId: deps.imessage.xrefByExt(p.message_handle)?.messageId ?? null,
        handleHash: hash,
        last4,
        at,
      });
    },
    applyReceipt(handle, state, reason) {
      if (state === 'queued') return; // our own queue already says "sending"
      const row = deps.imessage.outByExt(handle);
      if (row) {
        o.sdk.receipt(handle, state, reason);
        store.upsertId({
          kind: 'message',
          sbId: handle,
          conversation: row.target.startsWith('dm:')
            ? row.target
            : `group:${deps.imessage.binding(row.target)?.squadId ?? ''}`,
          messageId: row.messageId,
          at: deps.now(),
        });
        return;
      }
      // the callback can beat our own bookkeeping of the send: look again for a few seconds
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (deps.imessage.outByExt(handle) || tries > 40) {
          clearInterval(t);
          if (deps.imessage.outByExt(handle)) rt.applyReceipt(handle, state, reason);
        }
      }, o.retryMs ?? 250);
      t.unref?.();
    },
  };
  return rt;
}
