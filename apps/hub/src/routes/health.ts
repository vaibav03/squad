import { Hono } from 'hono';
import { requireUser } from '../auth';
import { contextServiceFor } from '../context/service';
import { registerAllHealthChecks } from '../health/checks';
import { runHealth } from '../health/registry';
import { normalizeOrigin } from '../web-origin';
import type { HubApp, HubDeps, HubEnv } from '../types';

/**
 * GET /v1/connections/health: one pass/warn/fail/blocked row per link of the integration chain, each from a real
 * probe, viewer-scoped, no secrets (docs/integration-health.md). The served origin is the request's Origin header
 * (or the Referer's origin): what the browser is actually showing.
 */
export function createHealthRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireUser(deps);
  r.get('/v1/connections/health', need, async (c) => {
    registerAllHealthChecks();
    const id = c.get('user').id;
    const squadIds = deps.directory.squadsOf(id).filter((q) => deps.squads.isMember(q, id));
    const ref = c.req.header('referer');
    let served = normalizeOrigin(c.req.header('origin'));
    if (!served && ref) {
      try {
        served = normalizeOrigin(new URL(ref).origin);
      } catch {
        served = null;
      }
    }
    // Same as listing connections: renew or expire credentials whose clock ran out, so the probes see the truth.
    const svc = contextServiceFor(deps);
    for (const x of svc.store.connectionsOf(id)) await svc.tick(x.id);
    const report = await runHealth(deps, { studentId: id, squadIds }, served, deps.now());
    c.header('Cache-Control', 'no-store');
    return c.json(report);
  });
  return r;
}
