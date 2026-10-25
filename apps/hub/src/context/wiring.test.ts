import { describe, expect, it } from 'vitest';
import { hashExternalAccount, normalizeItem, type ContextStore } from '@squad/brain';
import type { SourceKind } from '@squad/core';
import { createHub } from '../app';
import { withContext, noGrounder } from '../live/grounder';
import { busyBlocksOf } from '../adapters/real';
import { contextServiceFor } from './service';
import { contextBusyBlocks, mergeContextBusy, refreshBusyForTrip } from './busy';

const T0 = Date.UTC(2026, 10, 2, 12);

function hub() {
  const h = createHub({ config: { seed: true, sim: false, authSecret: 'x', logLevel: 'silent' } });
  h.deps.now = () => T0;
  const store = contextServiceFor(h.deps).store;
  const add = (
    owner: string,
    kind: SourceKind,
    id: string,
    title: string,
    extra: object = {},
    text = 'Plain body text for this item.',
  ) => {
    if (!store.connection(`c_${owner}`))
      store.upsertConnection({
        id: `c_${owner}`,
        ownerId: owner,
        provider: 'canvas',
        mode: 'fixture',
        variant: 'session',
        accountHash: hashExternalAccount('p', 'canvas', owner),
        scopes: [],
        status: 'live',
        degraded: false,
        statusNote: null,
        createdAt: T0,
        lastSyncAt: null,
        expiresAt: null,
      });
    const { source, pieces } = normalizeItem(
      { ownerId: owner, connectionId: `c_${owner}`, provider: 'canvas', mode: 'fixture', now: T0 },
      { externalId: id, kind, title, courseId: 'c1', url: null, modifiedAt: null, ...extra },
      { text },
    );
    store.upsertSource(source, pieces);
    return source;
  };
  return { h, store, add };
}

describe('context wiring in the hub', () => {
  it('live agents ground on the asker own sources only (retrieve tool bound to the run viewer)', async () => {
    const { store, add } = hub();
    add(
      's_ana',
      'canvas_assignment',
      'a1',
      'Essay rubric',
      {},
      'The essay rubric rewards clear thesis statements.',
    );
    add(
      's_ben',
      'canvas_assignment',
      'b1',
      'Ben essay rubric',
      {},
      'Ben private essay rubric mentions his accommodation.',
    );
    const g = withContext(noGrounder, store as ContextStore);
    const ana = await g.ground('essay rubric', {
      demo: false,
      viewer: { studentId: 's_ana', squadIds: ['sq1'] },
    });
    expect(ana.pages.map((p) => p.file)).toEqual(['Essay rubric']);
    expect(JSON.stringify(ana)).not.toContain('accommodation');
    expect((await g.ground('essay rubric', { demo: false })).pages).toEqual([]);
    const zed = await g.ground('essay rubric', {
      demo: false,
      viewer: { studentId: 's_zed', squadIds: ['sq_other'] },
    });
    expect(zed.pages).toEqual([]);
  });

  it('connected-calendar busy blocks carry no titles and merge idempotently', () => {
    const { h, add } = hub();
    add('s_ana', 'gcal_event', 'e1', 'Doctor appointment', {
      startsAt: T0 + 86_400_000,
      endsAt: T0 + 86_400_000 + 3_600_000,
    });
    expect(contextBusyBlocks(h.deps, 's_ana')).toEqual([
      { start: '2026-11-03T12:00:00Z', end: '2026-11-03T13:00:00Z', title: 'busy' },
    ]);
    expect(contextBusyBlocks(h.deps, 's_ben')).toEqual([]);
    mergeContextBusy(h.deps, 's_ana');
    expect(mergeContextBusy(h.deps, 's_ana')).toBe(1);
    const rows = busyBlocksOf(h.deps, 's_ana');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Doctor');
  });

  it("trip planning refreshes every member's calendar busy blocks (busy only, no titles)", async () => {
    const { h, add } = hub();
    add('s_ana', 'gcal_event', 'e2', 'Therapy session', {
      startsAt: T0 + 86_400_000,
      endsAt: T0 + 86_400_000 + 3_600_000,
    });
    await refreshBusyForTrip(h.deps, ['s_ana', 's_ben'], {});
    expect(busyBlocksOf(h.deps, 's_ana')).toHaveLength(1);
    expect(busyBlocksOf(h.deps, 's_ben')).toHaveLength(0);
    expect(JSON.stringify(busyBlocksOf(h.deps, 's_ana'))).not.toContain('Therapy');
  });
});
