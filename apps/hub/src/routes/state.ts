import { Hono } from 'hono';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

export function createStateRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  r.get('/v1/squad/state', requireViewer(deps), async (c) => {
    const snap = await deps.state.snapshot(c.get('viewer'));
    c.header('cache-control', 'no-store');
    return c.json(snap);
  });
  return r;
}
