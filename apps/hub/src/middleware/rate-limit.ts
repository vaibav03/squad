import { createHmac } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { Db } from '@squad/core';

/** Fixed-window counter. `hit` returns the count INCLUDING this hit. */
export interface RateStore {
  hit(key: string, windowMs: number, now: number): number;
  /** Read without counting. */
  peek(key: string, windowMs: number, now: number): number;
  /** Milliseconds until the current window for `key` ends (0 when there is none). */
  ttl(key: string, windowMs: number, now: number): number;
  reset(key: string): void;
}

export function memoryStore(maxKeys = 50_000): RateStore {
  const m = new Map<string, { start: number; n: number }>();
  const sweep = (now: number) => {
    if (m.size < maxKeys) return;
    for (const [k, v] of m) if (now - v.start > 3_600_000) m.delete(k);
    if (m.size >= maxKeys) m.clear(); // fail open on memory pressure rather than grow without bound
  };
  return {
    hit(key, windowMs, now) {
      const e = m.get(key);
      if (!e || now - e.start >= windowMs) {
        sweep(now);
        m.set(key, { start: now, n: 1 });
        return 1;
      }
      return ++e.n;
    },
    peek(key, windowMs, now) {
      const e = m.get(key);
      return e && now - e.start < windowMs ? e.n : 0;
    },
    ttl(key, windowMs, now) {
      const e = m.get(key);
      return e && now - e.start < windowMs ? e.start + windowMs - now : 0;
    },
    reset: (key) => void m.delete(key),
  };
}

/** Survives restarts (a restart must not reset a lockout). Uses the hub's shared sqlite. */
export function sqliteStore(db: Db): RateStore {
  db.exec(
    'CREATE TABLE IF NOT EXISTS sec_rate (k TEXT PRIMARY KEY, start INTEGER NOT NULL, n INTEGER NOT NULL)',
  );
  const get = db.prepare('SELECT start, n FROM sec_rate WHERE k = ?');
  const put = db.prepare(
    'INSERT INTO sec_rate(k, start, n) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET start=excluded.start, n=excluded.n',
  );
  const del = db.prepare('DELETE FROM sec_rate WHERE k = ?');
  const row = (k: string) => get.get(k) as { start: number; n: number } | undefined;
  return {
    hit(key, windowMs, now) {
      const e = row(key);
      if (!e || now - e.start >= windowMs) {
        put.run(key, now, 1);
        return 1;
      }
      put.run(key, e.start, e.n + 1);
      return e.n + 1;
    },
    peek(key, windowMs, now) {
      const e = row(key);
      return e && now - e.start < windowMs ? e.n : 0;
    },
    ttl(key, windowMs, now) {
      const e = row(key);
      return e && now - e.start < windowMs ? e.start + windowMs - now : 0;
    },
    reset: (key) => void del.run(key),
  };
}

export interface Rule {
  /** route method + path prefix or exact path; `*` method matches all */
  method: string;
  path: string | RegExp;
  /** bucket name */
  name: string;
  limit: number;
  windowMs: number;
  by: 'user' | 'ip' | 'both';
}

export interface LimiterOptions {
  store: RateStore;
  rules: Rule[];
  now: () => number;
  /** trust X-Forwarded-For (only behind a proxy you control) */
  trustProxy: boolean;
  /** key for hashing identities in stores/logs */
  hashKey: string;
  /** resolve student id from the request when authenticated (set by auth middleware, else undefined) */
  userOf: (c: Context) => string | undefined;
  /** called when a request is throttled */
  onLimit?: (info: { rule: string; rid?: string }) => void;
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    const first = xff?.split(',')[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export const idHash = (key: string, v: string) =>
  createHmac('sha256', key).update(v).digest('base64url').slice(0, 12);

/** Per-route limiter. One response shape (429 + Retry-After) so clients can back off. */
export function rateLimit(o: LimiterOptions): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;
    const now = o.now();
    for (const r of o.rules) {
      if (r.method !== '*' && r.method !== method) continue;
      const match =
        typeof r.path === 'string'
          ? path === r.path || path.startsWith(r.path + '/')
          : r.path.test(path);
      if (!match) continue;
      const keys: string[] = [];
      const ip = idHash(o.hashKey, clientIp(c, o.trustProxy));
      const user = o.userOf(c);
      if (r.by === 'ip' || r.by === 'both') keys.push(`${r.name}|ip|${ip}`);
      if ((r.by === 'user' || r.by === 'both') && user)
        keys.push(`${r.name}|u|${idHash(o.hashKey, user)}`);
      if (r.by === 'user' && !user) keys.push(`${r.name}|ip|${ip}`); // unauthenticated: fall back to IP
      for (const k of keys) {
        if (o.store.hit(k, r.windowMs, now) > r.limit) {
          o.onLimit?.({ rule: r.name });
          // seconds until THIS key's window ends (not the whole window), so a client waits only as long as needed
          const retry = Math.max(1, Math.ceil(o.store.ttl(k, r.windowMs, now) / 1000));
          return c.json({ error: { code: 'rate_limited', retryAfterS: retry } }, 429, {
            'retry-after': String(retry),
          });
        }
      }
    }
    return next();
  };
}

/**
 * Failure lockout with exponential-ish backoff: after `free` failures inside the window the key is locked
 * for the rest of the window; each further failure while locked extends nothing (no amplification) but is counted.
 */
export function failureLimiter(
  store: RateStore,
  o: { free: number; windowMs: number; now: () => number },
) {
  return {
    locked: (key: string) => store.peek(key, o.windowMs, o.now()) >= o.free,
    fail: (key: string) => store.hit(key, o.windowMs, o.now()),
    ok: (key: string) => store.reset(key),
  };
}
