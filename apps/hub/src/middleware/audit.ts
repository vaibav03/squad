import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../log';
import { clientIp, idHash } from './rate-limit';

/**
 * Structured audit line per request. NO PII: no query string (stream tokens live there), no body, no
 * headers, no raw ids. Student and IP are keyed hashes (stable within a deployment, not reversible).
 */
export function auditLog(o: {
  log: Logger;
  hashKey: string;
  trustProxy: boolean;
  now: () => number;
  userOf: (c: import('hono').Context) => string | undefined;
}): MiddlewareHandler {
  return async (c, next) => {
    const t0 = o.now();
    await next();
    const path = new URL(c.req.url).pathname;
    if (path === '/health' || path === '/v1/health') return;
    const user = o.userOf(c);
    const route = (c.req.routePath || '').replace(/\*$/, '') || 'unmatched';
    o.log.info('audit', {
      rid: c.res.headers.get('x-request-id') ?? undefined,
      m: c.req.method,
      route,
      status: c.res.status,
      ms: o.now() - t0,
      u: user ? idHash(o.hashKey, user) : undefined,
      ip: idHash(o.hashKey, clientIp(c, o.trustProxy)),
    });
  };
}
