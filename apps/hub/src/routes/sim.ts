import { Hono } from 'hono';
import { z } from 'zod';
import { isDemoRunning, playDemoRun, plannedEventCount } from '../sim/demo-run';
import { seedDemo } from '../sim/seed';
import type { HubApp, HubDeps, HubEnv } from '../types';

const Run = z.strictObject({ speed: z.number().min(0.1).max(1000).optional() });
let abort: AbortController | null = null;

/** Dev-only routes (mounted only when config.sim). 404 in production. */
export function createSimRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  r.use('/__sim/*', async (c, next) => {
    if (deps.config.production) return c.json({ error: { code: 'not_found' } }, 404);
    await next();
  });

  r.post('/__sim/squad/demo-run', async (c) => {
    const body = Run.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (isDemoRunning())
      return c.json({ error: { code: 'conflict', message: 'demo run in progress' } }, 409);
    abort = new AbortController();
    void playDemoRun(deps, {
      ...(body.data.speed ? { speed: body.data.speed } : {}),
      signal: abort.signal,
    }).catch((e: Error) => deps.log.warn('demo run failed', { err: e.message }));
    return c.json({ ok: true, events: plannedEventCount() });
  });

  r.post('/__sim/squad/reset', (c) => {
    abort?.abort();
    deps.ingest.reset();
    deps.events.clear();
    deps.state.reset();
    deps.ledger.clear();
    deps.trips.clear();
    deps.calls.clear();
    deps.projector.clear();
    deps.directory.clear();
    if (deps.config.seed) seedDemo(deps);
    return c.json({ ok: true, seq: deps.events.lastSeq() });
  });

  r.post('/__sim/squad/emit', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const ev = (body as { event?: unknown } | null)?.event;
    const res = deps.ingest.village(ev);
    return res.ok
      ? c.json({ ok: true, seq: res.seq })
      : c.json({ error: { code: 'invalid_event', issues: res.issues } }, 422);
  });

  return r;
}
