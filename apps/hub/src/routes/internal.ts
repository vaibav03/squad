import { Hono } from 'hono';
import { secretMatches } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const MAX_BODY = 64 * 1024;

export function createInternalRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();

  r.post('/internal/events', async (c) => {
    // Auth first: an unauthenticated caller's body is never read or parsed.
    if (!secretMatches(c.req.header('x-nook-internal'), deps.config.internalSecret))
      return c.json({ error: { code: 'unauthorized' } }, 401);
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_BODY)
      return c.json({ error: { code: 'invalid_request', message: 'body too large' } }, 413);
    const raw = await c.req.text();
    if (raw.length > MAX_BODY)
      return c.json({ error: { code: 'invalid_request', message: 'body too large' } }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ error: { code: 'invalid_request', message: 'invalid JSON' } }, 400);
    }
    const o = body as { type?: unknown; data?: unknown } | null;
    const res =
      o && typeof o.type === 'string' && o.type.startsWith('x.')
        ? deps.ingest.x(o.type, o.data)
        : deps.ingest.village(body);
    if (!res.ok) return c.json({ error: { code: 'invalid_event', issues: res.issues } }, 422);
    return c.json({ ok: true, seq: res.seq, ...(res.dropped ? { dropped: res.dropped } : {}) });
  });

  return r;
}
