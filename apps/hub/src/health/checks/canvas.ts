import { connectionState, type ContextConnection } from '@squad/brain';
import { contextServiceFor } from '../../context/service';
import { registerHealthCheck, type HealthCtx, type HealthResult } from '../registry';

const CONN = '/squad/connections';
const mine = (ctx: HealthCtx, provider: 'canvas' | 'google') => {
  const svc = contextServiceFor(ctx.deps);
  return { svc, all: svc.store.connectionsOf(ctx.viewer.studentId).filter((c) => c.provider === provider) };
};
const live = (all: ContextConnection[]) => all.filter((c) => c.status !== 'revoked');

export function canvasConnected(ctx: HealthCtx): HealthResult {
  const { svc, all } = mine(ctx, 'canvas');
  const act = live(all);
  const label = 'Canvas connected';
  if (act.length === 0) {
    const paired = svc.ext.paired(ctx.viewer.studentId);
    return {
      label,
      status: 'warn',
      mode: paired ? 'extension paired, no Canvas account yet' : 'extension not detected',
      reason: paired
        ? 'The Squad extension is paired but no Canvas account has been registered. Open Canvas in that browser and sync.'
        : all.length
          ? 'Canvas was disconnected and its imported data deleted. Nothing is connected.'
          : 'Canvas is not connected. The Squad extension is not detected for this account and no calendar feed is set.',
      fix: { label: paired ? 'Sync from Canvas' : 'Set up Canvas', to: CONN },
    };
  }
  // Worst state wins: expired/revoked-like first, then degraded, then live ones.
  const states = act.map((c) => ({ c, st: connectionState(c) }));
  const bad = states.find((x) => x.st === 'expired' || x.st === 'revoked');
  if (bad)
    return {
      label,
      status: 'fail',
      mode: 'expired',
      reason: 'The Canvas connection expired. Imported data is kept but may be out of date.',
      fix: { label: 'Reconnect Canvas', to: CONN },
    };
  const err = states.find((x) => x.st === 'error' || x.st === 'rate_limited');
  if (err)
    return {
      label,
      status: 'warn',
      mode: err.st,
      reason:
        err.st === 'rate_limited'
          ? 'Canvas is rate limiting; syncing resumes automatically.'
          : 'The last Canvas sync failed; showing the last imported data.',
      fix: { label: 'Sync again', to: CONN },
    };
  const real = states.find((x) => x.c.mode === 'live');
  if (!real)
    return {
      label,
      status: 'warn',
      mode: 'fixture',
      reason: 'Fixture (simulated, not your account): Canvas shows demo data, not a real Canvas account.',
      fix: { label: 'Connect real Canvas', to: CONN },
    };
  const v = real.c.variant;
  return {
    label,
    status: 'pass',
    mode: v === 'session' ? 'extension' : v === 'feed' ? 'feed' : 'token',
    reason:
      v === 'session'
        ? 'Connected through your signed-in Canvas session (the Squad extension).'
        : v === 'feed'
          ? 'Connected through your Canvas calendar feed.'
          : 'Connected with a Canvas access token you supplied.',
  };
}

export function canvasSynced(ctx: HealthCtx): HealthResult {
  const { svc, all } = mine(ctx, 'canvas');
  const act = live(all);
  const label = 'Canvas synced';
  if (act.length === 0)
    return { label, status: 'warn', reason: 'Nothing to sync: Canvas is not connected.', fix: { label: 'Set up Canvas', to: CONN } };
  const items = act.reduce((n, c) => n + svc.store.sourcesOfConnection(c.id).length, 0);
  const last = Math.max(0, ...act.map((c) => c.lastSyncAt ?? 0)) || null;
  const fixture = act.every((c) => c.mode === 'fixture');
  const facts = { items, lastSyncAt: last, fixture };
  if (last === null || items === 0)
    return {
      label,
      status: 'warn',
      mode: fixture ? 'fixture' : 'real',
      facts,
      reason: last === null ? 'Connected but never synced.' : 'Synced, but no items were imported.',
      fix: { label: 'Sync now', to: CONN },
    };
  const ageH = (ctx.now - last) / 3_600_000;
  return {
    label,
    status: ageH > 24 ? 'warn' : 'pass',
    mode: fixture ? 'fixture' : 'real',
    facts,
    reason: `${items} item${items === 1 ? '' : 's'} imported, last synced ${Math.max(0, Math.round((ctx.now - last) / 60000))} min ago${fixture ? ' (fixture data)' : ''}.${ageH > 24 ? ' That is over a day ago.' : ''}`,
    ...(ageH > 24 ? { fix: { label: 'Sync now', to: CONN } } : {}),
  };
}

export function registerCanvasChecks(): void {
  registerHealthCheck('canvas_connected', 'canvas', 10, canvasConnected);
  registerHealthCheck('canvas_synced', 'canvas', 11, canvasSynced);
}
