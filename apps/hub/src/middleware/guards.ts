import type { MiddlewareHandler } from 'hono';
import type { HubDeps } from '../types';

const deny = (c: import('hono').Context, status: 403 | 404, code: string) =>
  c.json({ error: { code } }, status);

/**
 * GET /v1/ledger/:taskId must only answer for tasks of the viewer's own squad. The route itself filters
 * withheld values per viewer but not the task's squad, so a guessed task id leaked other squads' shared text.
 * Unknown and foreign tasks answer the same 404 (no existence oracle).
 */
export function ledgerScope(
  deps: HubDeps,
  userOf: (c: import('hono').Context) => string | undefined,
): MiddlewareHandler {
  return async (c, next) => {
    const m = /^\/v1\/ledger\/([^/]+)$/.exec(new URL(c.req.url).pathname);
    if (!m || c.req.method !== 'GET') return next();
    const student = userOf(c);
    const squadId = student ? deps.directory.squadOf(student) : undefined;
    if (!squadId) return next(); // the route's own auth answers 401
    const taskId = decodeURIComponent(m[1] as string);
    const own =
      deps.ledger.taskIds(squadId, deps.directory).includes(taskId) ||
      deps.trips.byTask(taskId)?.squadId === squadId;
    return own ? next() : deny(c, 404, 'not_found');
  };
}

/** Caps concurrent SSE connections per student; the slot is released when the stream ends or is cancelled. */
export function sseCap(
  max: number,
  userOf: (c: import('hono').Context) => string | undefined,
): MiddlewareHandler {
  const open = new Map<string, number>();
  return async (c, next) => {
    if (new URL(c.req.url).pathname !== '/v1/squad/stream') return next();
    const u = userOf(c);
    if (!u) return next();
    const n = open.get(u) ?? 0;
    if (n >= max)
      return c.json({ error: { code: 'rate_limited', message: 'too many streams' } }, 429);
    open.set(u, n + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const k = (open.get(u) ?? 1) - 1;
      if (k <= 0) open.delete(u);
      else open.set(u, k);
    };
    try {
      await next();
    } catch (e) {
      release();
      throw e;
    }
    const res = c.res;
    if (!res.body || res.status !== 200) {
      release();
      return;
    }
    const reader = res.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        try {
          const r = await reader.read();
          if (r.done) {
            release();
            ctl.close();
          } else ctl.enqueue(r.value);
        } catch (e) {
          release();
          ctl.error(e);
        }
      },
      cancel(reason) {
        release();
        return reader.cancel(reason);
      },
    });
    c.res = new Response(body, res);
    return;
  };
}
