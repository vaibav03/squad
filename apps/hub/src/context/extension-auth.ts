import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '@squad/core';

/**
 * Pairing for the Squad browser extension. Nook signs the extension in with a phone code on its options page;
 * Squad already has authenticated web sessions, so the extension is paired instead: the signed-in web app mints a
 * one-time code (10 minutes), the extension exchanges it for a scoped bearer that works only on the Canvas
 * register and sync endpoints, is revocable, and expires in 30 days. Only hashes are stored.
 */
const PAIR_TTL_MS = 10 * 60_000;
const TOKEN_TTL_MS = 30 * 24 * 3_600_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ExtensionAuth {
  /** Mint a one-time pairing code for an authenticated user. */
  pair(userId: string): { code: string; expiresAt: number };
  /** Exchange a code for the extension bearer. Wrong, used or expired codes all answer `null`. */
  exchange(code: string): { token: string; userId: string; expiresAt: number } | null;
  /** The user behind a valid, unrevoked, unexpired extension bearer. */
  verify(token: string): string | null;
  /** Revoke every extension session of a user (disconnect everywhere). */
  revokeAll(userId: string): number;
}

export function createExtensionAuth(db: Db, now: () => number): ExtensionAuth {
  db.exec(`CREATE TABLE IF NOT EXISTS ctx_ext_pairing(
    code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
  CREATE TABLE IF NOT EXISTS ctx_ext_sessions(
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, secret_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);`);
  // Brute-force guard: a code has 40 bits and lives 10 minutes; also cap wrong guesses per minute, globally.
  let window = { at: 0, fails: 0 };
  const normalise = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    pair(userId) {
      const raw = Array.from(randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join('');
      const expiresAt = now() + PAIR_TTL_MS;
      db.prepare('DELETE FROM ctx_ext_pairing WHERE expires_at < ? OR user_id = ?').run(
        now(),
        userId,
      );
      db.prepare('INSERT INTO ctx_ext_pairing(code_hash, user_id, expires_at) VALUES(?,?,?)').run(
        sha(raw),
        userId,
        expiresAt,
      );
      return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
    },
    exchange(code) {
      const t = now();
      if (t - window.at > 60_000) window = { at: t, fails: 0 };
      if (window.fails >= 20) return null;
      const row = db
        .prepare('SELECT user_id, expires_at, used_at FROM ctx_ext_pairing WHERE code_hash=?')
        .get(sha(normalise(code))) as
        { user_id: string; expires_at: number; used_at: number | null } | undefined;
      if (!row || row.used_at !== null || row.expires_at <= t) {
        window.fails++;
        return null;
      }
      db.prepare('UPDATE ctx_ext_pairing SET used_at=? WHERE code_hash=?').run(
        t,
        sha(normalise(code)),
      );
      const id = randomBytes(9).toString('hex');
      const secret = randomBytes(24).toString('base64url');
      const expiresAt = t + TOKEN_TTL_MS;
      db.prepare(
        'INSERT INTO ctx_ext_sessions(id, user_id, secret_hash, expires_at) VALUES(?,?,?,?)',
      ).run(id, row.user_id, sha(secret), expiresAt);
      return { token: `sqx_${id}.${secret}`, userId: row.user_id, expiresAt };
    },
    verify(token) {
      const m = /^sqx_([0-9a-f]{18})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
      if (!m) return null;
      const row = db
        .prepare(
          'SELECT user_id, secret_hash, expires_at, revoked_at FROM ctx_ext_sessions WHERE id=?',
        )
        .get(m[1]) as
        | { user_id: string; secret_hash: string; expires_at: number; revoked_at: number | null }
        | undefined;
      if (!row || row.revoked_at !== null || row.expires_at <= now()) return null;
      const a = Buffer.from(sha(m[2] ?? ''));
      const b = Buffer.from(row.secret_hash);
      return a.length === b.length && timingSafeEqual(a, b) ? row.user_id : null;
    },
    revokeAll(userId) {
      return Number(
        db
          .prepare(
            'UPDATE ctx_ext_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
          )
          .run(now(), userId).changes,
      );
    },
  };
}
