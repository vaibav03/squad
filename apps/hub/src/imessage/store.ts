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

export interface ImessageStore {
  binding(chatGuid: string): Binding | undefined;
  bindingsOf(squadId: string): Binding[];
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

  return {
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
