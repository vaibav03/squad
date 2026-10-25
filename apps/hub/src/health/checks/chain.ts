import { createRetrieveContext, ownSources } from '@squad/brain';
import { contextServiceFor } from '../../context/service';
import { contextBusyBlocks } from '../../context/busy';
import { registerHealthCheck, type HealthCtx, type HealthResult } from '../registry';

const CONN = '/squad/connections';
const viewerOf = (ctx: HealthCtx) => ({ studentId: ctx.viewer.studentId, squadIds: ctx.viewer.squadIds });
const anyConn = (ctx: HealthCtx) =>
  contextServiceFor(ctx.deps).store.connectionsOf(ctx.viewer.studentId).some((c) => c.status !== 'revoked');

export function itemsVisible(ctx: HealthCtx): HealthResult {
  const label = 'Imported items visible';
  const svc = contextServiceFor(ctx.deps);
  const items = ownSources(svc.store, viewerOf(ctx));
  const fixture = items.length > 0 && items.every((s) => s.provenance.endsWith(':fixture'));
  if (items.length === 0)
    return anyConn(ctx)
      ? { label, status: 'fail', reason: 'A source is connected but you can read no imported items. Sync again.', fix: { label: 'Sync now', to: CONN } }
      : { label, status: 'warn', reason: 'No imported items: connect Canvas or Google first.', fix: { label: 'Connect a source', to: CONN } };
  return {
    label,
    status: 'pass',
    mode: fixture ? 'fixture' : 'real',
    facts: { items: items.length, fixture },
    reason: `${items.length} imported item${items.length === 1 ? '' : 's'} readable by you${fixture ? ' (fixture data)' : ''}.`,
  };
}

/** A live retrieval probe: search for words of an item you own through the same read gate chat and plans use. */
export async function contextRetrievable(ctx: HealthCtx): Promise<HealthResult> {
  const label = 'Context retrievable by Squad';
  const svc = contextServiceFor(ctx.deps);
  const v = viewerOf(ctx);
  const items = ownSources(svc.store, v).filter((s) => svc.store.chunks(s.id).length > 0);
  if (items.length === 0)
    return { label, status: 'warn', reason: 'Nothing to retrieve yet (no imported item has text).', fix: { label: 'Sync now', to: CONN } };
  const retrieve = createRetrieveContext(svc.store, v, { limit: 3 });
  for (const s of items.slice(0, 5)) {
    const q = s.title.split(/\s+/).slice(0, 4).join(' ');
    const hits = await retrieve(q);
    const cited = hits.filter((h) => h.sourceId && h.anchor);
    if (cited.length > 0)
      return {
        label,
        status: 'pass',
        mode: s.provenance.endsWith(':fixture') ? 'fixture' : 'real',
        facts: { probeHits: cited.length },
        reason: `A live search returned ${cited.length} cited chunk${cited.length === 1 ? '' : 's'} with source and location.`,
      };
  }
  return {
    label,
    status: 'fail',
    reason: 'Items exist but a live search for their own titles returned no cited chunk: the index is empty or unreadable.',
    fix: { label: 'Sync again', to: CONN },
  };
}

export function studyPlanPersisted(ctx: HealthCtx): HealthResult {
  const label = 'Study plan persisted';
  const sq = ctx.viewer.squadIds[0];
  if (!sq) return { label, status: 'warn', reason: 'You are not in a squad, so there is no shared plan.', fix: { label: 'Join a squad', to: '/squad/squads' } };
  const row = ctx.deps.db.prepare('SELECT json FROM hub_plans WHERE squad_id=? ORDER BY updated_at DESC LIMIT 1').get(sq) as
    | { json: string }
    | undefined;
  if (!row) return { label, status: 'warn', reason: 'No study plan saved yet for your squad.', fix: { label: 'Generate a plan', to: '/squad/plan' } };
  const plan = JSON.parse(row.json) as import('@squad/core').Plan;
  const cites = [...plan.citations, ...plan.items.flatMap((i) => i.sources)].filter((c) => c.source).length;
  const mode = plan.generator?.mode ?? 'unknown';
  return {
    label,
    status: cites > 0 ? 'pass' : 'warn',
    mode,
    facts: { items: plan.items.length, importedCitations: cites, generator: plan.generator?.kind ?? null },
    reason:
      cites > 0
        ? `Saved plan (${plan.items.length} items, ${mode}) cites ${cites} imported item${cites === 1 ? '' : 's'}.`
        : `A plan is saved (${mode}) but cites no imported Canvas/Google item.`,
    ...(cites > 0 ? {} : { fix: { label: 'Regenerate with imported items', to: '/squad/plan' } }),
  };
}

export function tripAvailability(ctx: HealthCtx): HealthResult {
  const label = 'Trip availability uses busy blocks';
  const svc = contextServiceFor(ctx.deps);
  const cal = ownSources(svc.store, viewerOf(ctx)).filter((s) => s.kind === 'gcal_event' || s.kind === 'canvas_event');
  if (cal.length === 0)
    return { label, status: 'warn', reason: 'No imported calendar, so trips cannot see when you are busy.', fix: { label: 'Connect a calendar', to: CONN } };
  const blocks = contextBusyBlocks(ctx.deps, ctx.viewer.studentId);
  const untitled = blocks.every((b) => b.title === 'busy');
  if (blocks.length === 0 || !untitled)
    return { label, status: 'fail', reason: blocks.length === 0 ? 'Calendar imported but no busy blocks were derived.' : 'Busy blocks carry titles: privacy rule broken.' };
  return {
    label,
    status: 'pass',
    facts: { busyBlocks: blocks.length },
    reason: `${blocks.length} busy block${blocks.length === 1 ? '' : 's'} derived, start and end only; titles never leave your account.`,
  };
}

export function registerChainChecks(): void {
  registerHealthCheck('items_visible', 'chain', 40, itemsVisible);
  registerHealthCheck('context_retrievable', 'chain', 41, contextRetrievable);
  registerHealthCheck('study_plan_persisted', 'chain', 60, studyPlanPersisted);
  registerHealthCheck('trip_availability', 'chain', 61, tripAvailability);
}
