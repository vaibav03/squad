import type { Context } from 'hono';
import { verifyToken } from '../auth';
import type { HubApp, HubDeps } from '../types';
import { assertSafeConfig } from '../security/config-guard';
import { auditLog } from './audit';
import { bodyGuard } from './body';
import { ledgerScope, sseCap, streamTokenOnly } from './guards';
import { securityHeaders } from './headers';
import { memoryStore, rateLimit, sqliteStore, type RateStore, type Rule } from './rate-limit';
import { requestId } from './request-id';
import { uploadGuard } from './uploads';

export interface SecurityOptions {
  /** 'off' disables rate limits (load tests). Default 'on'. */
  rateLimits?: 'on' | 'off';
  store?: 'memory' | 'sqlite';
  trustProxy?: boolean;
  /** 'enforce' refuses to boot on an unsafe production config. Default: enforce, except under vitest. */
  configCheck?: 'enforce' | 'skip';
  /** Override or extend the default rules. */
  rules?: Rule[];
  maxStreamsPerUser?: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Defaults are generous for humans and hostile to scripts. LLM- and TTS-backed routes are the tightest. */
export const DEFAULT_RULES: Rule[] = [
  {
    name: 'login',
    method: 'POST',
    path: '/v1/auth/dev-login',
    limit: 300,
    windowMs: 5 * MIN,
    by: 'ip',
  },
  {
    name: 'students',
    method: 'GET',
    path: '/v1/auth/students',
    limit: 120,
    windowMs: MIN,
    by: 'ip',
  },
  {
    name: 'stream-token',
    method: 'POST',
    path: '/v1/squad/stream-token',
    limit: 60,
    windowMs: MIN,
    by: 'user',
  },
  {
    name: 'call-start',
    method: 'POST',
    path: '/v1/call/start',
    limit: 20,
    windowMs: HOUR,
    by: 'user',
  },
  {
    name: 'upload-course',
    method: 'POST',
    path: '/v1/squad/courses',
    limit: 10,
    windowMs: HOUR,
    by: 'user',
  },
  {
    name: 'upload-cal',
    method: 'POST',
    path: '/v1/squad/calendar',
    limit: 20,
    windowMs: HOUR,
    by: 'user',
  },
  {
    name: 'tts-preview',
    method: 'POST',
    path: '/v1/voices/preview',
    limit: 30,
    windowMs: MIN,
    by: 'user',
  },
  { name: 'persona', method: 'PUT', path: '/v1/personas', limit: 20, windowMs: MIN, by: 'user' },
  { name: 'quiz-answer', method: 'POST', path: '/v1/quiz', limit: 120, windowMs: MIN, by: 'user' },
  // chat/council routes land from other leads; limits are keyed on path prefix so they apply on merge
  { name: 'chat-send', method: 'POST', path: '/v1/chat', limit: 60, windowMs: MIN, by: 'user' },
  {
    name: 'council-ask',
    method: 'POST',
    path: '/v1/council',
    limit: 12,
    windowMs: HOUR,
    by: 'user',
  },
  {
    name: 'internal',
    method: 'POST',
    path: '/internal/events',
    limit: 6000,
    windowMs: MIN,
    by: 'ip',
  },
  { name: 'api-ip', method: '*', path: '/v1', limit: 3000, windowMs: MIN, by: 'ip' },
  { name: 'api-user', method: '*', path: '/v1', limit: 1200, windowMs: MIN, by: 'user' },
];

/** Resolve the student behind a request without throwing; cached per request. */
export function makeUserOf(deps: HubDeps): (c: Context) => string | undefined {
  const cache = new WeakMap<object, string | null>();
  return (c) => {
    const key = c.req.raw;
    if (cache.has(key)) return cache.get(key) ?? undefined;
    const h = c.req.header('authorization');
    let sub: string | undefined;
    if (h?.startsWith('Bearer '))
      sub = verifyToken(deps.config.authSecret, h.slice(7), ['bearer'], deps.now())?.sub;
    else {
      const st = c.req.query('st');
      if (st)
        sub = verifyToken(
          deps.config.authSecret,
          st,
          ['stream', 'bearer', 'call'],
          deps.now(),
        )?.sub;
    }
    cache.set(key, sub ?? null);
    return sub;
  };
}

/**
 * One registration point for the hub's HTTP hardening. Call BEFORE the route groups are mounted
 * (middleware order is registration order). Idempotent per app.
 */
export function applySecurity(app: HubApp, deps: HubDeps, o: SecurityOptions = {}): void {
  const { config, log, now } = deps;
  if ((o.configCheck ?? (process.env.VITEST ? 'skip' : 'enforce')) === 'enforce')
    assertSafeConfig(config, (m, f) => log.warn(m, f), {
      allowDemo: process.env.HUB_ALLOW_DEMO === '1',
    });
  const trustProxy = o.trustProxy ?? process.env.HUB_TRUST_PROXY === '1';
  const userOf = makeUserOf(deps);
  const hashKey = config.authSecret;
  const store: RateStore =
    (o.store ?? (process.env.HUB_RATE_STORE as 'sqlite' | undefined) ?? 'memory') === 'sqlite'
      ? sqliteStore(deps.db)
      : memoryStore();

  app.use('*', requestId());
  app.use('*', securityHeaders({ hsts: config.production }));
  app.use('*', auditLog({ log, hashKey, trustProxy, now, userOf }));
  app.use(
    '*',
    bodyGuard({ jsonMax: 256 * 1024, multipartMax: 52 * 1024 * 1024, exempt: ['/internal/'] }),
  );
  if ((o.rateLimits ?? (process.env.HUB_RATE_LIMITS === 'off' ? 'off' : 'on')) === 'on')
    app.use(
      '*',
      rateLimit({
        store,
        rules: o.rules ?? DEFAULT_RULES,
        now,
        trustProxy,
        hashKey,
        userOf,
        onLimit: ({ rule }) => log.warn('rate limited', { rule }),
      }),
    );
  app.use('*', streamTokenOnly(deps));
  app.use('*', sseCap(o.maxStreamsPerUser ?? 12, userOf));
  app.use('*', ledgerScope(deps, userOf));
  app.use('*', uploadGuard());
}

export { securityHeaders, apiHeaders, webHostHeaders } from './headers';
export { memoryStore, sqliteStore, rateLimit, failureLimiter } from './rate-limit';
