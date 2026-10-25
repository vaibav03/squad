import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import { CANVAS_SCOPES, GOOGLE_SCOPES, createDemoCanvasConnector, createDemoGoogleConnector } from './connectors';
import { hashExternalAccount } from './ids';
import { createContextStore } from './store';
import { syncConnection } from './sync';
import { combinedDueStudyReply, isCombinedDueStudyQuestion } from './answers-rich';
import { ownSources } from './readable';
import type { ContextConnection } from './types';

const NOW = Date.UTC(2026, 9, 25, 15, 0);
const Q = '@cubbie what is due from Canvas this week and what Google files should I study?';

async function demoStore() {
  const store = createContextStore(openMemoryDb());
  const mk = (id: string, provider: 'canvas' | 'google'): ContextConnection => ({
    id, ownerId: 's_ana', provider, mode: 'fixture', variant: 'demo',
    accountHash: hashExternalAccount('p', provider, id), scopes: [], status: 'live', degraded: false,
    statusNote: null, createdAt: NOW, lastSyncAt: null, expiresAt: null,
  });
  const c = mk('c_canvas', 'canvas');
  const g = mk('c_google', 'google');
  store.upsertConnection(c);
  store.upsertConnection(g);
  store.setCourses(c.id, await createDemoCanvasConnector(() => NOW).listCourses({ variant: 'feed', feedUrl: 'demo://workspace' }));
  await syncConnection({ store, now: () => NOW }, c, createDemoCanvasConnector(() => NOW), { variant: 'feed', feedUrl: 'demo://workspace' });
  await syncConnection({ store, now: () => NOW }, g, createDemoGoogleConnector(() => NOW), {
    accessToken: 'x', scopes: Object.values(GOOGLE_SCOPES),
  });
  void CANVAS_SCOPES;
  return store;
}

describe('combined due + Google files answer', () => {
  it('detects the two intents together only', () => {
    expect(isCombinedDueStudyQuestion(Q)).toBe(true);
    expect(isCombinedDueStudyQuestion('what is due this week?')).toBe(false);
    expect(isCombinedDueStudyQuestion('which google files should I study')).toBe(false);
  });

  it('lists this-week items with course code+name, later items separately, and Drive docs with a reason each, all cited as fixture', async () => {
    const store = await demoStore();
    const sources = ownSources(store, { studentId: 's_ana', squadIds: [] });
    const r = combinedDueStudyReply(store, sources, NOW, new Map(), Q)!;
    const [due, rest] = r.text.split('Next after this week:');
    const [later, files] = rest!.split('Google files to study:');
    expect(due).toMatch(/Due this week/);
    expect(due).toMatch(/Assignment 1: Describe a dataset \(STAT 101: Introduction to Statistics\): due Wednesday, Oct 28/);
    expect(due).toMatch(/Reading response 1: Caravan towns \(HIST 140: Modern World History\)/);
    expect(later).toMatch(/Assignment 2: Sampling experiment/);
    expect(files).toMatch(/STAT 101: dataset and sampling study guide: for Assignment 1: Describe a dataset \(due Wed, Oct 28\)/);
    expect(files).toMatch(/HIST 140: caravan towns reading notes: for Reading response 1/);
    expect(files).toMatch(/BIO 120: osmosis lab plan/);
    expect(files).not.toMatch(/ECON/);
    const drive = r.citations.filter((c) => /^gdoc|^gdrive/.test(c.source!.kind));
    expect(drive.length).toBeGreaterThanOrEqual(3);
    expect(r.citations.every((c) => c.source!.provenance === 'fixture')).toBe(true);
    expect(r.citations.some((c) => c.source!.kind === 'canvas_assignment')).toBe(true);
  });

  it('is honest when no Drive files are imported', () => {
    const store = createContextStore(openMemoryDb());
    expect(combinedDueStudyReply(store, [], NOW, new Map(), Q)).toBeNull();
  });
});
