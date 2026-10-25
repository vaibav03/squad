// Integration health registry: each branch/feature registers its own checks (one file per group) so none conflict.
// Every check must be a REAL probe of the thing it names; a static pass is a bug.
import { overallHealth, type HealthCheck, type HealthGroup, type HealthReport } from '@squad/core';
import type { HubDeps } from '../types';

export interface HealthCtx {
  deps: HubDeps;
  /** The signed-in viewer; every check is viewer-scoped. */
  viewer: { studentId: string; squadIds: string[] };
  now: number;
  /** Web origin currently being served (Origin header / configured), if known. */
  servedOrigin: string | null;
  /** Results of earlier checks in this run, by id (for chain dependencies). */
  prior: ReadonlyMap<string, HealthCheck>;
}
export type HealthResult = Omit<HealthCheck, 'id' | 'group' | 'probedAt'>;
export type HealthProbe = (ctx: HealthCtx) => Promise<HealthResult> | HealthResult;

interface Entry {
  id: string;
  group: HealthGroup;
  order: number;
  probe: HealthProbe;
}
const entries = new Map<string, Entry>();

/** Register (or replace, by id) one chain link. Lower `order` runs first and may be read via `ctx.prior`. */
export function registerHealthCheck(id: string, group: HealthGroup, order: number, probe: HealthProbe): void {
  entries.set(id, { id, group, order, probe });
}

export async function runHealth(
  deps: HubDeps,
  viewer: HealthCtx['viewer'],
  servedOrigin: string | null,
  now = Date.now(),
): Promise<HealthReport> {
  const prior = new Map<string, HealthCheck>();
  for (const e of [...entries.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    let r: HealthResult;
    try {
      r = await Promise.race([
        Promise.resolve(e.probe({ deps, viewer, now, servedOrigin, prior })),
        new Promise<HealthResult>((_, rej) => setTimeout(() => rej(new Error('probe_timeout')), 4000)),
      ]);
    } catch (err) {
      r = { label: e.id, status: 'fail', reason: `The probe itself failed (${(err as Error).message}).` };
    }
    prior.set(e.id, { ...r, id: e.id, group: e.group, probedAt: Date.now() });
  }
  const checks = [...prior.values()];
  return { generatedAt: now, overall: overallHealth(checks), servedOrigin, checks };
}
