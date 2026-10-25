import { randomBytes } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

/** Attaches an opaque request id (never client-controlled beyond a strict charset) and echoes it. */
export function requestId(): MiddlewareHandler {
  return async (c, next) => {
    const given = c.req.header('x-request-id');
    const id = given && /^[\w-]{8,64}$/.test(given) ? given : randomBytes(8).toString('hex');
    c.set('rid' as never, id as never);
    await next();
    c.res.headers.set('x-request-id', id);
  };
}
