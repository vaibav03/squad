// Sendblue id map and webhook event ledger (docs/sendblue.md section 5). Own migration scope, so it never collides
// with the iMessage store's numbering. Raw phone numbers are never stored: a salted hash plus the last 4 digits.
import type { Db } from '@squad/core';
import { runMigrations, type Migration } from '../../store/migrate';

export const SENDBLUE_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'sendblue: id map, status ledger, webhook events',
    sql: `
CREATE TABLE IF NOT EXISTS sb_id_map(
  kind TEXT NOT NULL,            -- 'group' | 'thread' | 'message'
  sb_id TEXT NOT NULL,           -- Sendblue group_id | thread key | message_handle
  chat_guid TEXT,                -- the bridge chat guid (Sendblue;+;<group_id> or Sendblue;-;<hash>)
  conversation TEXT,             -- the Squad conversation id (group:<squad> | dm:<user>) once known
  message_id TEXT,               -- the hub chat message id (messages)
  handle_hash TEXT, last4 TEXT,
  first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  PRIMARY KEY(kind, sb_id));
CREATE INDEX IF NOT EXISTS sb_id_map_msg ON sb_id_map(message_id);
CREATE TABLE IF NOT EXISTS sb_status(
  message_handle TEXT PRIMARY KEY, state TEXT NOT NULL, rank INTEGER NOT NULL,
  error_code TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sb_events(
  event_key TEXT PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sb_meta(k TEXT PRIMARY KEY, v INTEGER NOT NULL);`,
  },
];

export type SbKind = 'group' | 'thread' | 'message';
export const STATE_RANK: Record<string, number> = { queued: 1, sent: 2, delivered: 3, read: 4 };

export interface SendblueStore {
  /** Idempotent upsert: the first mapping wins for conversation fields, later calls only fill blanks. */
  upsertId(r: {
    kind: SbKind;
    sbId: string;
    chatGuid?: string | null;
    conversation?: string | null;
    messageId?: string | null;
    handleHash?: string | null;
    last4?: string | null;
    at: number;
  }): void;
  lookup(
    kind: SbKind,
    sbId: string,
  ): { chatGuid: string | null; conversation: string | null; messageId: string | null } | undefined;
  countIds(kind: SbKind): number;
  /** Claim a webhook event key (`in:<handle>` / `st:<handle>:<status>`). false = replay. */
  claimEvent(key: string, kind: 'in' | 'status', at: number): boolean;
  /** Record a status; returns the transition to apply, or undefined for stale/duplicate/regressing ones. */
  recordStatus(
    handle: string,
    state: 'queued' | 'sent' | 'delivered' | 'read' | 'failed',
    errorCode: string | null,
    at: number,
  ): 'apply' | 'ignore';
  setMeta(k: 'last_inbound' | 'last_status' | 'last_verified', v: number): void;
  meta(k: 'last_inbound' | 'last_status' | 'last_verified'): number | undefined;
  lastStatus(): { state: string; errorCode: string | null; at: number } | undefined;
  prune(now: number): void;
}

const EVENT_TTL_MS = 7 * 24 * 3_600_000;

export function createSendblueStore(db: Db): SendblueStore {
  runMigrations(db, 'sendblue', SENDBLUE_MIGRATIONS);
  let lastPrune = 0;
  return {
    upsertId(r) {
      db.prepare(
        `INSERT INTO sb_id_map(kind,sb_id,chat_guid,conversation,message_id,handle_hash,last4,first_seen,last_seen)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(kind,sb_id) DO UPDATE SET
           chat_guid=COALESCE(sb_id_map.chat_guid,excluded.chat_guid),
           conversation=COALESCE(sb_id_map.conversation,excluded.conversation),
           message_id=COALESCE(sb_id_map.message_id,excluded.message_id),
           handle_hash=COALESCE(sb_id_map.handle_hash,excluded.handle_hash),
           last4=COALESCE(sb_id_map.last4,excluded.last4),
           last_seen=excluded.last_seen`,
      ).run(
        r.kind,
        r.sbId,
        r.chatGuid ?? null,
        r.conversation ?? null,
        r.messageId ?? null,
        r.handleHash ?? null,
        r.last4 ?? null,
        r.at,
        r.at,
      );
    },
    lookup(kind, sbId) {
      const row = db
        .prepare('SELECT chat_guid,conversation,message_id FROM sb_id_map WHERE kind=? AND sb_id=?')
        .get(kind, sbId) as
        | { chat_guid: string | null; conversation: string | null; message_id: string | null }
        | undefined;
      return row
        ? { chatGuid: row.chat_guid, conversation: row.conversation, messageId: row.message_id }
        : undefined;
    },
    countIds(kind) {
      return (
        db.prepare('SELECT COUNT(*) n FROM sb_id_map WHERE kind=?').get(kind) as { n: number }
      ).n;
    },
    claimEvent(key, kind, at) {
      const r = db
        .prepare('INSERT OR IGNORE INTO sb_events(event_key,kind,at) VALUES(?,?,?)')
        .run(key, kind, at);
      return r.changes > 0;
    },
    recordStatus(handle, state, errorCode, at) {
      const cur = db
        .prepare('SELECT state,rank FROM sb_status WHERE message_handle=?')
        .get(handle) as { state: string; rank: number } | undefined;
      const rank = state === 'failed' ? 9 : (STATE_RANK[state] ?? 1);
      if (cur) {
        if (cur.state === state) return 'ignore';
        // delivered/read is final: a late SENT/ERROR for the same message must not undo it
        if (cur.state === 'failed') {
          if (state === 'failed') return 'ignore';
        } else if (state === 'failed' ? cur.rank >= STATE_RANK.delivered! : rank <= cur.rank) {
          return 'ignore';
        }
      }
      db.prepare(
        `INSERT INTO sb_status(message_handle,state,rank,error_code,updated_at) VALUES(?,?,?,?,?)
         ON CONFLICT(message_handle) DO UPDATE SET state=excluded.state,rank=excluded.rank,error_code=excluded.error_code,updated_at=excluded.updated_at`,
      ).run(handle, state, rank, errorCode, at);
      return 'apply';
    },
    setMeta(k, v) {
      db.prepare(
        'INSERT INTO sb_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v',
      ).run(k, v);
    },
    meta(k) {
      return (db.prepare('SELECT v FROM sb_meta WHERE k=?').get(k) as { v: number } | undefined)?.v;
    },
    lastStatus() {
      const r = db
        .prepare(
          'SELECT state,error_code,updated_at FROM sb_status ORDER BY updated_at DESC LIMIT 1',
        )
        .get() as { state: string; error_code: string | null; updated_at: number } | undefined;
      return r ? { state: r.state, errorCode: r.error_code, at: r.updated_at } : undefined;
    },
    prune(now) {
      if (now - lastPrune < 3_600_000) return;
      lastPrune = now;
      db.prepare('DELETE FROM sb_events WHERE at<?').run(now - EVENT_TTL_MS);
    },
  };
}
