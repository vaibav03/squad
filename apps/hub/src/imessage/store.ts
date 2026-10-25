// iMessage binding store (docs/imessage.md). Owned by the iMessage integration; migrations run at boot.
// Raw phone numbers and emails are NEVER stored: handles are kept as the same salted HMAC the accounts store uses,
// plus a masked hint for display.
import { randomInt } from 'node:crypto';
import { INVITE_ALPHABET, maskContact, type ContactChannel } from '@squad/core';
import type { Db } from '@squad/core';
import { runMigrations, type Migration } from '../store/migrate';

export const IMESSAGE_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'chat bindings, handle links, link codes, seen guids, participants',
    sql: `
CREATE TABLE IF NOT EXISTS chat_bindings(
  chat_guid TEXT PRIMARY KEY, squad_id TEXT NOT NULL, bound_by TEXT NOT NULL, bound_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS chat_bindings_squad ON chat_bindings(squad_id);
CREATE TABLE IF NOT EXISTS imsg_links(
  handle_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES acct_users(id) ON DELETE CASCADE,
  hint TEXT NOT NULL, linked_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS imsg_links_user ON imsg_links(user_id);
CREATE TABLE IF NOT EXISTS imsg_link_codes(
  code TEXT PRIMARY KEY, handle_hash TEXT NOT NULL, hint TEXT NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE INDEX IF NOT EXISTS imsg_link_codes_handle ON imsg_link_codes(handle_hash);
CREATE TABLE IF NOT EXISTS imsg_seen(guid TEXT PRIMARY KEY, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS imsg_participants(
  chat_guid TEXT NOT NULL, handle_hash TEXT NOT NULL, hint TEXT NOT NULL, last_seen INTEGER NOT NULL,
  PRIMARY KEY(chat_guid, handle_hash));`,
  },
  {
    id: 2,
    name: 'sync: message identity map, per-chat cursor, outbound queue, squad mirror settings',
    sql: `
CREATE TABLE IF NOT EXISTS imsg_xref(
  ext_id TEXT PRIMARY KEY, direction TEXT NOT NULL, thread_key TEXT NOT NULL, message_id TEXT,
  status TEXT NOT NULL, handle_hash TEXT, origin_ts INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS imsg_xref_message ON imsg_xref(message_id);
CREATE INDEX IF NOT EXISTS imsg_xref_thread ON imsg_xref(thread_key, origin_ts);
CREATE TABLE IF NOT EXISTS imsg_cursor(
  thread_key TEXT PRIMARY KEY, last_ts INTEGER NOT NULL, last_guid TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS imsg_out(
  id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, target TEXT NOT NULL, part INTEGER NOT NULL,
  text TEXT, attachments TEXT, state TEXT NOT NULL, reason TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL, ext_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(message_id, target, part));
CREATE INDEX IF NOT EXISTS imsg_out_due ON imsg_out(state, next_at);
CREATE INDEX IF NOT EXISTS imsg_out_ext ON imsg_out(ext_id);
CREATE TABLE IF NOT EXISTS imsg_squad_settings(
  squad_id TEXT PRIMARY KEY, mirror TEXT NOT NULL DEFAULT 'bot_and_mentions', show_unlinked INTEGER NOT NULL DEFAULT 1);`,
  },
];

export const LINK_CODE_TTL_MS = 30 * 60_000;
const SEEN_TTL_MS = 7 * 24 * 3_600_000;

export interface Binding {
  chatGuid: string;
  squadId: string;
  boundBy: string;
  boundAt: number;
}

export interface Participant {
  handleHash: string;
  hint: string;
  lastSeen: number;
}

export type ConsumeResult =
  | { ok: true; handleHash: string; hint: string }
  | { ok: false; error: 'code_invalid' | 'code_expired' };

/** How much of the web squad chat reaches the bound iMessage groups (docs/imessage.md section 8.4). */
export type MirrorMode = 'bot_only' | 'bot_and_mentions' | 'full';
export const MIRROR_MODES: readonly MirrorMode[] = ['bot_only', 'bot_and_mentions', 'full'];
export interface SquadSyncSettings {
  mirror: MirrorMode;
  showUnlinked: boolean;
}

export type OutState = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'dry_run';
export interface OutRow {
  id: number;
  messageId: string;
  /** a group chat guid, or `dm:<handle hash>` (raw handles are never stored) */
  target: string;
  part: number;
  text: string | null;
  attachments: string[];
  state: OutState;
  reason: string | null;
  attempts: number;
  nextAt: number;
  extId: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface XrefRow {
  extId: string;
  direction: 'in' | 'out';
  threadKey: string;
  messageId: string | null;
  status: 'pending' | 'stored' | 'handled' | 'sent';
  handleHash: string | null;
  originTs: number;
}

export interface ImessageStore {
  // ---- sync: identity map (idempotent) ----
  /** Atomically claim an inbound guid. `duplicate` = already stored/handled or being handled right now. */
  claimInbound(
    extId: string,
    threadKey: string,
    handleHash: string | null,
    originTs: number,
  ): 'new' | 'duplicate';
  /** Mark an inbound guid finished: `stored` (has a hub message) or `handled` (command, hint, ignored). */
  finishInbound(extId: string, status: 'stored' | 'handled', messageId?: string): void;
  /** Release a claim whose handling threw, so a redelivery or backfill can retry it. */
  releaseInbound(extId: string): void;
  /** true when this guid is fully processed (stored or handled): the gateway uses it as its dedupe. */
  inboundDone(extId: string): boolean;
  xrefByExt(extId: string): XrefRow | undefined;
  xrefsOfMessage(messageId: string): XrefRow[];
  /** Record the transport's guid for one of our sends (identity map, direction out). Idempotent. */
  recordOutXref(extId: string, threadKey: string, messageId: string, originTs: number): void;
  // ---- sync: cursor ----
  cursor(threadKey: string): { lastTs: number; lastGuid: string | null } | undefined;
  /** Advance only forward. */
  advanceCursor(threadKey: string, ts: number, guid: string | null): void;
  cursors(): { threadKey: string; lastTs: number }[];
  // ---- sync: outbound queue ----
  /** Idempotent per (message, target, part). Returns the row (existing when it was already queued). */
  enqueueOut(r: {
    messageId: string;
    target: string;
    part: number;
    text: string | null;
    attachments?: string[];
    at: number;
  }): OutRow;
  outRow(id: number): OutRow | undefined;
  outOfMessage(messageId: string): OutRow[];
  outByExt(extId: string): OutRow | undefined;
  /** Queued rows whose time has come, oldest first. */
  dueOut(now: number, limit?: number): OutRow[];
  /** Queued rows ahead of `id` for the same target (a row waits for earlier ones: per-target order). */
  hasEarlierQueued(id: number, target: string): boolean;
  patchOut(
    id: number,
    p: Partial<Pick<OutRow, 'state' | 'reason' | 'attempts' | 'nextAt' | 'extId'>> & {
      clearPayload?: boolean;
    },
    now: number,
  ): OutRow | undefined;
  outCounts(): { queued: number; failed: number };
  // ---- sync: squad settings ----
  syncSettings(squadId: string): SquadSyncSettings;
  setSyncSettings(squadId: string, p: Partial<SquadSyncSettings>): SquadSyncSettings;

  binding(chatGuid: string): Binding | undefined;
  bindingsOf(squadId: string): Binding[];
  allBindings(): Binding[];
  /** Binds the chat to the squad. Returns false when the chat is already bound (to anything). */
  bind(chatGuid: string, squadId: string, boundBy: string): boolean;
  unbind(chatGuid: string): boolean;
  unbindSquad(squadId: string): number;
  /** A fresh (or the still-valid) first-contact code for this handle hash. */
  linkCodeFor(handleHash: string, hint: string): string;
  consumeLinkCode(code: string): ConsumeResult;
  link(handleHash: string, userId: string, hint: string): void;
  linkedUser(handleHash: string): string | undefined;
  linksOf(userId: string): { hint: string; linkedAt: number }[];
  unlinkUser(userId: string): number;
  /** true when this message guid was already processed (and records it otherwise). Survives restarts. */
  seen(guid: string): boolean;
  touchParticipant(chatGuid: string, handleHash: string, hint: string): void;
  participants(chatGuid: string): Participant[];
}

export function maskHandle(channel: ContactChannel, normalized: string): string {
  return maskContact(channel, normalized);
}

export function createImessageStore(db: Db, now: () => number): ImessageStore {
  runMigrations(db, 'imessage', IMESSAGE_MIGRATIONS);
  let lastPrune = 0;
  const code = () =>
    Array.from({ length: 6 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
  const toBinding = (r: {
    chat_guid: string;
    squad_id: string;
    bound_by: string;
    bound_at: number;
  }) => ({
    chatGuid: r.chat_guid,
    squadId: r.squad_id,
    boundBy: r.bound_by,
    boundAt: r.bound_at,
  });

  const toOut = (r: Record<string, unknown>): OutRow => ({
    id: r.id as number,
    messageId: r.message_id as string,
    target: r.target as string,
    part: r.part as number,
    text: (r.text as string | null) ?? null,
    attachments: r.attachments ? (JSON.parse(r.attachments as string) as string[]) : [],
    state: r.state as OutState,
    reason: (r.reason as string | null) ?? null,
    attempts: r.attempts as number,
    nextAt: r.next_at as number,
    extId: (r.ext_id as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  });
  const toXref = (r: Record<string, unknown>): XrefRow => ({
    extId: r.ext_id as string,
    direction: r.direction as 'in' | 'out',
    threadKey: r.thread_key as string,
    messageId: (r.message_id as string | null) ?? null,
    status: r.status as XrefRow['status'],
    handleHash: (r.handle_hash as string | null) ?? null,
    originTs: r.origin_ts as number,
  });
  /** A claim that never finished (crash mid-handling) can be taken over after this long. */
  const CLAIM_STALE_MS = 60_000;

  return {
    claimInbound(extId, threadKey, handleHash, originTs) {
      const t = now();
      const r = db
        .prepare(
          `INSERT OR IGNORE INTO imsg_xref(ext_id,direction,thread_key,message_id,status,handle_hash,origin_ts,created_at)
           VALUES(?,?,?,NULL,'pending',?,?,?)`,
        )
        .run(extId, 'in', threadKey, handleHash, originTs, t);
      if (r.changes > 0) return 'new';
      // a pending claim older than the stale window belongs to a crashed handler: take it over
      const took = db
        .prepare(
          `UPDATE imsg_xref SET created_at=? WHERE ext_id=? AND direction='in' AND status='pending' AND created_at<?`,
        )
        .run(t, extId, t - CLAIM_STALE_MS);
      return took.changes > 0 ? 'new' : 'duplicate';
    },
    finishInbound(extId, status, messageId) {
      db.prepare(
        'UPDATE imsg_xref SET status=?, message_id=COALESCE(?,message_id) WHERE ext_id=?',
      ).run(status, messageId ?? null, extId);
    },
    releaseInbound(extId) {
      db.prepare(`DELETE FROM imsg_xref WHERE ext_id=? AND status='pending'`).run(extId);
    },
    inboundDone(extId) {
      const r = db.prepare('SELECT status FROM imsg_xref WHERE ext_id=?').get(extId) as
        { status: string } | undefined;
      return !!r && r.status !== 'pending';
    },
    xrefByExt(extId) {
      const r = db.prepare('SELECT * FROM imsg_xref WHERE ext_id=?').get(extId);
      return r ? toXref(r as Record<string, unknown>) : undefined;
    },
    xrefsOfMessage(messageId) {
      return (
        db
          .prepare('SELECT * FROM imsg_xref WHERE message_id=? ORDER BY origin_ts')
          .all(messageId) as Record<string, unknown>[]
      ).map(toXref);
    },
    recordOutXref(extId, threadKey, messageId, originTs) {
      db.prepare(
        `INSERT OR IGNORE INTO imsg_xref(ext_id,direction,thread_key,message_id,status,handle_hash,origin_ts,created_at)
         VALUES(?,?,?,?,'sent',NULL,?,?)`,
      ).run(extId, 'out', threadKey, messageId, originTs, now());
    },
    cursor(k) {
      const r = db
        .prepare('SELECT last_ts, last_guid FROM imsg_cursor WHERE thread_key=?')
        .get(k) as { last_ts: number; last_guid: string | null } | undefined;
      return r ? { lastTs: r.last_ts, lastGuid: r.last_guid } : undefined;
    },
    advanceCursor(k, ts, guid) {
      db.prepare(
        `INSERT INTO imsg_cursor(thread_key,last_ts,last_guid,updated_at) VALUES(?,?,?,?)
         ON CONFLICT(thread_key) DO UPDATE SET last_ts=excluded.last_ts, last_guid=excluded.last_guid, updated_at=excluded.updated_at
         WHERE excluded.last_ts>imsg_cursor.last_ts`,
      ).run(k, ts, guid, now());
    },
    cursors() {
      return (
        db.prepare('SELECT thread_key, last_ts FROM imsg_cursor').all() as {
          thread_key: string;
          last_ts: number;
        }[]
      ).map((r) => ({ threadKey: r.thread_key, lastTs: r.last_ts }));
    },
    enqueueOut(r) {
      db.prepare(
        `INSERT OR IGNORE INTO imsg_out(message_id,target,part,text,attachments,state,next_at,created_at,updated_at)
         VALUES(?,?,?,?,?,'queued',?,?,?)`,
      ).run(
        r.messageId,
        r.target,
        r.part,
        r.text,
        r.attachments?.length ? JSON.stringify(r.attachments) : null,
        r.at,
        r.at,
        r.at,
      );
      return toOut(
        db
          .prepare('SELECT * FROM imsg_out WHERE message_id=? AND target=? AND part=?')
          .get(r.messageId, r.target, r.part) as Record<string, unknown>,
      );
    },
    outRow(id) {
      const r = db.prepare('SELECT * FROM imsg_out WHERE id=?').get(id);
      return r ? toOut(r as Record<string, unknown>) : undefined;
    },
    outOfMessage(messageId) {
      return (
        db
          .prepare('SELECT * FROM imsg_out WHERE message_id=? ORDER BY id')
          .all(messageId) as Record<string, unknown>[]
      ).map(toOut);
    },
    outByExt(extId) {
      const r = db.prepare('SELECT * FROM imsg_out WHERE ext_id=?').get(extId);
      return r ? toOut(r as Record<string, unknown>) : undefined;
    },
    dueOut(t, limit = 50) {
      return (
        db
          .prepare(`SELECT * FROM imsg_out WHERE state='queued' AND next_at<=? ORDER BY id LIMIT ?`)
          .all(t, limit) as Record<string, unknown>[]
      ).map(toOut);
    },
    hasEarlierQueued(id, target) {
      return !!db
        .prepare(`SELECT 1 FROM imsg_out WHERE state='queued' AND target=? AND id<? LIMIT 1`)
        .get(target, id);
    },
    patchOut(id, p, t) {
      const cur = this.outRow(id);
      if (!cur) return undefined;
      db.prepare(
        `UPDATE imsg_out SET state=?, reason=?, attempts=?, next_at=?, ext_id=?, updated_at=?${
          p.clearPayload ? ', text=NULL, attachments=NULL' : ''
        } WHERE id=?`,
      ).run(
        p.state ?? cur.state,
        p.reason === undefined ? cur.reason : p.reason,
        p.attempts ?? cur.attempts,
        p.nextAt ?? cur.nextAt,
        p.extId === undefined ? cur.extId : p.extId,
        t,
        id,
      );
      return this.outRow(id);
    },
    outCounts() {
      const q = (st: string) =>
        (db.prepare('SELECT COUNT(*) AS n FROM imsg_out WHERE state=?').get(st) as { n: number }).n;
      return { queued: q('queued'), failed: q('failed') };
    },
    syncSettings(squadId) {
      const r = db
        .prepare('SELECT mirror, show_unlinked FROM imsg_squad_settings WHERE squad_id=?')
        .get(squadId) as { mirror: string; show_unlinked: number } | undefined;
      return {
        mirror: (MIRROR_MODES as readonly string[]).includes(r?.mirror ?? '')
          ? (r!.mirror as MirrorMode)
          : 'bot_and_mentions',
        showUnlinked: r ? r.show_unlinked === 1 : true,
      };
    },
    setSyncSettings(squadId, p) {
      const cur = this.syncSettings(squadId);
      const next = { ...cur, ...p };
      db.prepare(
        `INSERT INTO imsg_squad_settings(squad_id,mirror,show_unlinked) VALUES(?,?,?)
         ON CONFLICT(squad_id) DO UPDATE SET mirror=excluded.mirror, show_unlinked=excluded.show_unlinked`,
      ).run(squadId, next.mirror, next.showUnlinked ? 1 : 0);
      return next;
    },
    binding(g) {
      const r = db.prepare('SELECT * FROM chat_bindings WHERE chat_guid=?').get(g) as
        Parameters<typeof toBinding>[0] | undefined;
      return r ? toBinding(r) : undefined;
    },
    bindingsOf(squadId) {
      return (
        db
          .prepare('SELECT * FROM chat_bindings WHERE squad_id=? ORDER BY bound_at')
          .all(squadId) as Parameters<typeof toBinding>[0][]
      ).map(toBinding);
    },
    allBindings() {
      return (
        db.prepare('SELECT * FROM chat_bindings ORDER BY bound_at').all() as Parameters<
          typeof toBinding
        >[0][]
      ).map(toBinding);
    },
    bind(g, squadId, by) {
      const r = db
        .prepare(
          'INSERT OR IGNORE INTO chat_bindings(chat_guid,squad_id,bound_by,bound_at) VALUES(?,?,?,?)',
        )
        .run(g, squadId, by, now());
      return r.changes > 0;
    },
    unbind(g) {
      return db.prepare('DELETE FROM chat_bindings WHERE chat_guid=?').run(g).changes > 0;
    },
    unbindSquad(squadId) {
      return db.prepare('DELETE FROM chat_bindings WHERE squad_id=?').run(squadId).changes;
    },
    linkCodeFor(h, hint) {
      const t = now();
      const live = db
        .prepare(
          'SELECT code FROM imsg_link_codes WHERE handle_hash=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1',
        )
        .get(h, t) as { code: string } | undefined;
      if (live) return live.code;
      for (;;) {
        const c = code();
        const r = db
          .prepare(
            'INSERT OR IGNORE INTO imsg_link_codes(code,handle_hash,hint,created_at,expires_at) VALUES(?,?,?,?,?)',
          )
          .run(c, h, hint, t, t + LINK_CODE_TTL_MS);
        if (r.changes > 0) return c;
      }
    },
    consumeLinkCode(raw) {
      const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const row = db.prepare('SELECT * FROM imsg_link_codes WHERE code=?').get(c) as
        | { handle_hash: string; hint: string; expires_at: number; used_at: number | null }
        | undefined;
      if (!row || row.used_at !== null) return { ok: false, error: 'code_invalid' };
      if (row.expires_at <= now()) return { ok: false, error: 'code_expired' };
      db.prepare('UPDATE imsg_link_codes SET used_at=? WHERE code=?').run(now(), c);
      return { ok: true, handleHash: row.handle_hash, hint: row.hint };
    },
    link(h, userId, hint) {
      db.prepare(
        'INSERT INTO imsg_links(handle_hash,user_id,hint,linked_at) VALUES(?,?,?,?) ON CONFLICT(handle_hash) DO UPDATE SET user_id=excluded.user_id, hint=excluded.hint, linked_at=excluded.linked_at',
      ).run(h, userId, hint, now());
    },
    linkedUser(h) {
      return (
        db.prepare('SELECT user_id FROM imsg_links WHERE handle_hash=?').get(h) as
          { user_id: string } | undefined
      )?.user_id;
    },
    linksOf(userId) {
      return (
        db.prepare('SELECT hint, linked_at FROM imsg_links WHERE user_id=?').all(userId) as {
          hint: string;
          linked_at: number;
        }[]
      ).map((r) => ({ hint: r.hint, linkedAt: r.linked_at }));
    },
    unlinkUser(userId) {
      return db.prepare('DELETE FROM imsg_links WHERE user_id=?').run(userId).changes;
    },
    seen(guid) {
      const t = now();
      if (t - lastPrune > 3_600_000) {
        lastPrune = t;
        db.prepare('DELETE FROM imsg_seen WHERE ts<?').run(t - SEEN_TTL_MS);
      }
      return (
        db.prepare('INSERT OR IGNORE INTO imsg_seen(guid,ts) VALUES(?,?)').run(guid, t).changes ===
        0
      );
    },
    touchParticipant(g, h, hint) {
      db.prepare(
        'INSERT INTO imsg_participants(chat_guid,handle_hash,hint,last_seen) VALUES(?,?,?,?) ON CONFLICT(chat_guid,handle_hash) DO UPDATE SET last_seen=excluded.last_seen',
      ).run(g, h, hint, now());
    },
    participants(g) {
      return (
        db
          .prepare(
            'SELECT handle_hash, hint, last_seen FROM imsg_participants WHERE chat_guid=? ORDER BY last_seen DESC',
          )
          .all(g) as { handle_hash: string; hint: string; last_seen: number }[]
      ).map((r) => ({ handleHash: r.handle_hash, hint: r.hint, lastSeen: r.last_seen }));
    },
  };
}
