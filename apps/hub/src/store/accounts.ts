import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { maskContact, type ContactChannel } from '@squad/core';
import type { Db } from '@squad/core';
import { runMigrations, type Migration } from './migrate';

export const ACCOUNT_MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'users, sessions, challenges',
    sql: `
CREATE TABLE IF NOT EXISTS acct_users(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, channel TEXT NOT NULL,
  contact_hash TEXT NOT NULL UNIQUE, contact_hint TEXT NOT NULL,
  avatar_url TEXT, persona_id TEXT, active_squad TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS acct_sessions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES acct_users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS acct_sessions_user ON acct_sessions(user_id);
CREATE TABLE IF NOT EXISTS acct_challenges(
  id TEXT PRIMARY KEY, channel TEXT NOT NULL, contact_hash TEXT NOT NULL, name TEXT,
  code_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  resend_after INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS acct_challenges_contact ON acct_challenges(contact_hash, created_at);`,
  },
];

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_TRIES = 5;
const STARTS_PER_HOUR = 5;
const ROTATE_GRACE_MS = 60 * 1000;
export const ROTATE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  name: string;
  channel: ContactChannel;
  hint: string;
  avatarUrl?: string;
  personaId?: string;
  activeSquad: string | null;
  createdAt: number;
}

export interface Challenge {
  id: string;
  channel: ContactChannel;
  hint: string;
  /** The plaintext code, returned once so the caller can hand it to a CodeSender. Never stored. */
  code: string;
  expiresAt: number;
  resendAfter: number;
}

export type StartResult =
  | { ok: true; challenge: Challenge }
  | { ok: false; error: 'name_required' | 'rate_limited' | 'not_found'; retryAfterS?: number };
export type VerifyResult =
  | { ok: true; user: UserRow; created: boolean }
  | {
      ok: false;
      error: 'code_invalid' | 'code_expired' | 'too_many_attempts' | 'not_found';
      triesLeft?: number;
    };

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface AccountsStore {
  hashContact(channel: ContactChannel, normalized: string): string;
  user(id: string): UserRow | undefined;
  users(): UserRow[];
  findByContact(channel: ContactChannel, normalized: string): UserRow | undefined;
  start(a: { channel: ContactChannel; normalized: string; name?: string }): StartResult;
  resend(challengeId: string): StartResult & { normalized?: string };
  /** The contact of a pending challenge, for the sender only (memory, never persisted). */
  pendingContact(challengeId: string): string | undefined;
  verify(challengeId: string, code: string): VerifyResult;
  createSession(userId: string): SessionRow;
  session(sid: string): SessionRow | undefined;
  /** Valid = exists, not revoked, not expired. */
  sessionValid(sid: string): boolean;
  /** New session for the same user; the old one lives 60 s more so parallel requests do not fail. */
  rotate(sid: string): SessionRow | null;
  revoke(sid: string): void;
  revokeAll(userId: string): void;
  setActiveSquad(userId: string, squadId: string | null): void;
  rename(userId: string, name: string): UserRow | undefined;
  /** Removes the user and (by cascade) sessions; also their challenges. Squad and data cleanup is the caller's. */
  deleteUser(userId: string): void;
}

interface UserDb {
  id: string;
  name: string;
  channel: string;
  contact_hint: string;
  avatar_url: string | null;
  persona_id: string | null;
  active_squad: string | null;
  created_at: number;
}
const toUser = (r: UserDb): UserRow => ({
  id: r.id,
  name: r.name,
  channel: r.channel as ContactChannel,
  hint: r.contact_hint,
  ...(r.avatar_url ? { avatarUrl: r.avatar_url } : {}),
  ...(r.persona_id ? { personaId: r.persona_id } : {}),
  activeSquad: r.active_squad,
  createdAt: r.created_at,
});

export function createAccountsStore(
  db: Db,
  o: { secret: string; pepper: string; now: () => number; sessionDays?: number; demoCode?: string | undefined },
): AccountsStore {
  runMigrations(db, 'accounts', ACCOUNT_MIGRATIONS);
  const { now } = o;
  const hmac = (key: string, v: string) => createHmac('sha256', key).update(v).digest('hex');
  const hashContact = (channel: ContactChannel, n: string) => hmac(o.pepper, `${channel}:${n}`);
  const codeHash = (id: string, code: string) => hmac(o.secret, `code:${id}:${code}`);
  /** Raw contacts of pending challenges: memory only, dropped on verify/expiry. */
  const pending = new Map<string, string>();

  const getUser = (id: string) => {
    const r = db.prepare('SELECT * FROM acct_users WHERE id=?').get(id) as UserDb | undefined;
    return r ? toUser(r) : undefined;
  };

  function issue(
    id: string | null,
    base: { channel: ContactChannel; normalized: string; name?: string },
  ): Challenge {
    const t = now();
    const code = o.demoCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const cid = id ?? `ch_${randomBytes(12).toString('hex')}`;
    const hint = maskContact(base.channel, base.normalized);
    const row = {
      expires: t + CODE_TTL_MS,
      resend: t + RESEND_MS,
    };
    if (id) {
      db.prepare(
        'UPDATE acct_challenges SET code_hash=?, expires_at=?, resend_after=?, tries=0 WHERE id=?',
      ).run(codeHash(cid, code), row.expires, row.resend, cid);
    } else {
      db.prepare(
        'INSERT INTO acct_challenges(id,channel,contact_hash,name,code_hash,created_at,expires_at,resend_after) VALUES(?,?,?,?,?,?,?,?)',
      ).run(
        cid,
        base.channel,
        hashContact(base.channel, base.normalized),
        base.name ?? null,
        codeHash(cid, code),
        t,
        row.expires,
        row.resend,
      );
    }
    pending.set(cid, base.normalized);
    return {
      id: cid,
      channel: base.channel,
      hint,
      code,
      expiresAt: row.expires,
      resendAfter: row.resend,
    };
  }

  const store: AccountsStore = {
    hashContact,
    user: getUser,
    users: () => (db.prepare('SELECT * FROM acct_users').all() as UserDb[]).map(toUser),
    findByContact(channel, normalized) {
      const r = db
        .prepare('SELECT * FROM acct_users WHERE contact_hash=?')
        .get(hashContact(channel, normalized)) as UserDb | undefined;
      return r ? toUser(r) : undefined;
    },
    start(a) {
      const hash = hashContact(a.channel, a.normalized);
      const t = now();
      const recent = db
        .prepare(
          'SELECT created_at FROM acct_challenges WHERE contact_hash=? AND created_at>? ORDER BY created_at',
        )
        .all(hash, t - 3_600_000) as { created_at: number }[];
      if (recent.length >= STARTS_PER_HOUR) {
        const oldest = recent[0]?.created_at ?? t;
        return {
          ok: false,
          error: 'rate_limited',
          retryAfterS: Math.max(1, Math.ceil((oldest + 3_600_000 - t) / 1000)),
        };
      }
      const exists = store.findByContact(a.channel, a.normalized);
      if (!exists && !a.name) return { ok: false, error: 'name_required' };
      return { ok: true, challenge: issue(null, a) };
    },
    pendingContact: (id) => pending.get(id),
    resend(challengeId) {
      const r = db
        .prepare('SELECT * FROM acct_challenges WHERE id=? AND consumed=0')
        .get(challengeId) as
        { channel: string; resend_after: number; contact_hash: string } | undefined;
      const contact = pending.get(challengeId);
      if (!r || !contact) return { ok: false, error: 'not_found' };
      const t = now();
      if (t < r.resend_after)
        return {
          ok: false,
          error: 'rate_limited',
          retryAfterS: Math.ceil((r.resend_after - t) / 1000),
        };
      const ch = issue(challengeId, { channel: r.channel as ContactChannel, normalized: contact });
      return { ok: true, challenge: ch, normalized: contact };
    },
    verify(challengeId, code) {
      const r = db.prepare('SELECT * FROM acct_challenges WHERE id=?').get(challengeId) as
        | {
            id: string;
            channel: string;
            contact_hash: string;
            name: string | null;
            code_hash: string;
            expires_at: number;
            tries: number;
            consumed: number;
          }
        | undefined;
      if (!r || r.consumed) return { ok: false, error: 'not_found' };
      if (now() > r.expires_at) return { ok: false, error: 'code_expired' };
      if (r.tries >= MAX_TRIES) return { ok: false, error: 'too_many_attempts' };
      const want = Buffer.from(r.code_hash);
      const got = Buffer.from(codeHash(r.id, code.trim()));
      if (want.length !== got.length || !timingSafeEqual(want, got)) {
        db.prepare('UPDATE acct_challenges SET tries=tries+1 WHERE id=?').run(r.id);
        const left = MAX_TRIES - (r.tries + 1);
        return left <= 0
          ? { ok: false, error: 'too_many_attempts' }
          : { ok: false, error: 'code_invalid', triesLeft: left };
      }
      db.prepare('UPDATE acct_challenges SET consumed=1 WHERE id=?').run(r.id);
      const contact = pending.get(r.id);
      pending.delete(r.id);
      const existing = db
        .prepare('SELECT * FROM acct_users WHERE contact_hash=?')
        .get(r.contact_hash) as UserDb | undefined;
      if (existing) return { ok: true, user: toUser(existing), created: false };
      if (!r.name) return { ok: false, error: 'not_found' };
      const id = `u_${randomBytes(6).toString('hex')}`;
      const hint = contact ? maskContact(r.channel as ContactChannel, contact) : `••••`;
      db.prepare(
        'INSERT INTO acct_users(id,name,channel,contact_hash,contact_hint,created_at) VALUES(?,?,?,?,?,?)',
      ).run(id, r.name, r.channel, r.contact_hash, hint, now());
      return { ok: true, user: getUser(id) as UserRow, created: true };
    },
    createSession(userId) {
      const t = now();
      const s: SessionRow = {
        id: `ss_${randomBytes(12).toString('hex')}`,
        userId,
        createdAt: t,
        expiresAt: t + (o.sessionDays ?? 30) * 86_400_000,
      };
      db.prepare('INSERT INTO acct_sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(
        s.id,
        userId,
        s.createdAt,
        s.expiresAt,
      );
      return s;
    },
    session(sid) {
      const r = db.prepare('SELECT * FROM acct_sessions WHERE id=?').get(sid) as
        | {
            id: string;
            user_id: string;
            created_at: number;
            expires_at: number;
            revoked_at: number | null;
          }
        | undefined;
      if (!r || r.revoked_at !== null) return undefined;
      return { id: r.id, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at };
    },
    sessionValid(sid) {
      const s = store.session(sid);
      return !!s && s.expiresAt > now();
    },
    rotate(sid) {
      const old = store.session(sid);
      if (!old || old.expiresAt <= now()) return null;
      const next = store.createSession(old.userId);
      db.prepare('UPDATE acct_sessions SET expires_at=? WHERE id=?').run(
        Math.min(old.expiresAt, now() + ROTATE_GRACE_MS),
        sid,
      );
      return next;
    },
    revoke(sid) {
      db.prepare('UPDATE acct_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(
        now(),
        sid,
      );
    },
    revokeAll(userId) {
      db.prepare(
        'UPDATE acct_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
      ).run(now(), userId);
    },
    setActiveSquad(userId, squadId) {
      db.prepare('UPDATE acct_users SET active_squad=? WHERE id=?').run(squadId, userId);
    },
    rename(userId, name) {
      db.prepare('UPDATE acct_users SET name=? WHERE id=?').run(name, userId);
      return getUser(userId);
    },
    deleteUser(userId) {
      const u = db.prepare('SELECT contact_hash FROM acct_users WHERE id=?').get(userId) as
        { contact_hash: string } | undefined;
      if (u) db.prepare('DELETE FROM acct_challenges WHERE contact_hash=?').run(u.contact_hash);
      db.prepare('DELETE FROM acct_users WHERE id=?').run(userId);
    },
  };
  return store;
}
