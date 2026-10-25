import { describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES, courseLabel } from '@squad/brain';
import { createHub } from '../app';
import { signToken } from '../auth';
import { contextServiceFor } from './service';
import { contextBusyBlocks } from './busy';
import { integrationStateOf, rollupState } from './state';

const SECRET = 'onboard-int-secret-0123456789abcdef';
const T0 = Date.UTC(2026, 10, 3, 9); // a Tuesday
const GOOGLE = Object.values(GOOGLE_SCOPES);

function setup() {
  const hub = createHub({
    config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
    now: () => T0,
  });
  const call = async (method: string, path: string, sub: string, body?: unknown) => {
    const res = await hub.app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }, T0).token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text || 'null') as any };
  };
  const canvasDemo = (sub = 's_ana') =>
    call('POST', '/v1/connections', sub, { provider: 'canvas', variant: 'demo', scopes: ['canvas.demo_workspace'] });
  const googleDemo = (sub = 's_ana') =>
    call('POST', '/v1/connections', sub, { provider: 'google', variant: 'demo', scopes: GOOGLE });
  return { hub, call, canvasDemo, googleDemo, svc: contextServiceFor(hub.deps) };
}

describe('demo workspaces', () => {
  it('Canvas demo: 3 courses with modules, pages, files, assignments (due relative to today), announcements; labelled Demo, never Live', async () => {
    const { canvasDemo, call, svc } = setup();
    const r = await canvasDemo();
    expect(r.status).toBe(201);
    const c = r.json.connection;
    expect(c).toMatchObject({ mode: 'fixture', fixture: true, integrationState: 'demo', variant: 'demo' });
    expect(c.account).toEqual({ label: 'Demo workspace (simulated)', name: 'Demo student' });
    expect(c.modeLabel).toMatch(/^Demo data/);
    expect(c.counts).toEqual({
      courses: 3, modules: 6, assignments: 6, pages: 6, files: 3, announcements: 3,
      calendarEvents: 3, driveDocs: 0, classroomItems: 0,
    });
    const items = (await call('GET', '/v1/connections/items', 's_ana')).json.items as any[];
    expect(items.every((i) => i.provenance === 'fixture' && i.fixture)).toBe(true);
    expect(items.every((i) => i.sharing === 'private')).toBe(true);
    const due = items.filter((i) => i.kind === 'canvas_assignment');
    expect(due).toHaveLength(6);
    for (const a of due) {
      expect(a.whenKind).toBe('due');
      expect(a.whenAt).toBeGreaterThan(T0);
      expect(a.whenAt).toBeLessThan(T0 + 16 * 86_400_000);
    }
    // stable ids across a re-sync
    const ids = items.map((i) => i.id).sort();
    await call('POST', `/v1/connections/${c.id}/sync`, 's_ana');
    const again = ((await call('GET', '/v1/connections/items', 's_ana')).json.items as any[]).map((i) => i.id).sort();
    expect(again).toEqual(ids);
    // citable: pages carry page anchors and a search returns a cited chunk with source + anchor
    const hit = (await call('GET', '/v1/context/search?q=' + encodeURIComponent('standard error square root sample size'), 's_ana')).json
      .results[0];
    expect(hit.anchor).toMatch(/^p\d/);
    expect(hit.provenance).toBe('canvas:fixture');
    const src = (await call('GET', `/v1/context/source?id=${hit.sourceId}&anchor=${hit.anchor}`, 's_ana')).json;
    expect(src).toMatchObject({ ok: true, provenance: 'fixture' });
    void svc;
  });

  it('Google demo: a believable week of classes, Classroom coursework and Drive docs', async () => {
    const { googleDemo } = setup();
    const r = await googleDemo();
    expect(r.status).toBe(201);
    expect(r.json.connection).toMatchObject({ fixture: true, integrationState: 'demo' });
    const k = r.json.connection.counts;
    expect(k.calendarEvents).toBeGreaterThanOrEqual(5);
    expect(k.driveDocs).toBe(6);
    expect(k.classroomItems).toBe(2);
    expect(k.courses).toBe(1);
  });

  it('existing fixture API still works (feed variant)', async () => {
    const { call } = setup();
    const r = await call('POST', '/v1/connections', 's_ana', {
      provider: 'canvas', variant: 'feed', scopes: ['canvas.calendar_feed'], feedUrl: 'https://canvas.fixture.invalid/feeds/calendars/user_x.ics',
    });
    expect(r.status).toBe(201);
    expect(r.json.connection.integrationState).toBe('demo');
  });
});

describe('integration state function', () => {
  const base = { mode: 'live' as const, status: 'live' as const, degraded: false, lastSyncAt: 5 };
  it('maps every record to one state; fixture is never live', () => {
    expect(integrationStateOf(base)).toEqual({ state: 'live', sub: null });
    expect(integrationStateOf({ ...base, mode: 'fixture' })).toEqual({ state: 'demo', sub: null });
    expect(integrationStateOf({ ...base, lastSyncAt: null })).toEqual({ state: 'connecting', sub: null });
    expect(integrationStateOf(base, { startedAt: 1 })).toEqual({ state: 'syncing', sub: null });
    expect(integrationStateOf({ ...base, status: 'expired' }).state).toBe('reauth_required');
    expect(integrationStateOf({ ...base, status: 'error' }).state).toBe('degraded');
    expect(integrationStateOf({ ...base, status: 'rate_limited' }).state).toBe('degraded');
    expect(integrationStateOf({ ...base, degraded: true }).state).toBe('degraded');
    expect(integrationStateOf({ ...base, status: 'revoked' })).toEqual({ state: 'not_connected', sub: 'disconnected' });
    expect(rollupState([])).toEqual({ state: 'not_connected', sub: null });
    expect(rollupState([{ state: 'demo', sub: null }, { state: 'reauth_required', sub: null }]).state).toBe('reauth_required');
  });

  it('transitions are honest through disconnect and reconnect', async () => {
    const { canvasDemo, call } = setup();
    const id = (await canvasDemo()).json.connection.id as string;
    expect((await call('GET', '/v1/onboarding', 's_ana')).json.integrations.canvas.state).toBe('demo');
    await call('DELETE', `/v1/connections/${id}`, 's_ana');
    const o = (await call('GET', '/v1/onboarding', 's_ana')).json;
    expect(o.integrations.canvas).toMatchObject({ state: 'not_connected', sub: 'disconnected' });
    expect(o.integrations.canvas.counts.assignments).toBe(0);
    const list = (await call('GET', '/v1/connections', 's_ana')).json.connections[0];
    expect(list).toMatchObject({ integrationState: 'not_connected', integrationSub: 'disconnected' });
    expect((await canvasDemo()).json.connection.integrationState).toBe('demo');
  });

  it('health checks carry the same integrationState', async () => {
    const { canvasDemo, call } = setup();
    await canvasDemo();
    const h = (await call('GET', '/v1/connections/health', 's_ana')).json;
    const c = h.checks.find((x: any) => x.id === 'canvas_connected');
    expect(c.integrationState).toBe('demo');
    expect(h.checks.find((x: any) => x.id === 'google_connected').integrationState).toBe('not_connected');
  });
});

describe('onboarding and sharing', () => {
  it('walks identity -> connect -> sharing -> done; skip persists; default is private', async () => {
    const { call, canvasDemo, hub } = setup();
    const sq = hub.deps.directory.squadsOf('s_ana')[0]!;
    let o = (await call('GET', '/v1/onboarding', 's_ana')).json;
    expect(o).toMatchObject({ identityDone: true, sharingChosen: false, skipped: null, nextStep: 'connect' });
    expect(o.integrations.canvas.state).toBe('not_connected');
    await canvasDemo();
    o = (await call('GET', '/v1/onboarding', 's_ana')).json;
    expect(o.nextStep).toBe('sharing');
    expect(o.integrations.canvas.counts.assignments).toBe(6);
    expect(o.integrations.canvas.demo).toBe(true);
    expect((await call('POST', '/v1/onboarding/sharing', 's_ana', { squadId: 'sq_nope', choice: 'squad' })).status).toBe(404);
    expect((await call('POST', '/v1/onboarding/sharing', 's_ana', { squadId: sq, choice: 'bogus' })).status).toBe(400);
    const s = await call('POST', '/v1/onboarding/sharing', 's_ana', { squadId: sq, choice: 'private' });
    expect(s.json).toMatchObject({ sharingChosen: true, sharedNow: 0, nextStep: 'done' });
    const sk = await call('POST', '/v1/onboarding/skip', 's_ben');
    expect(sk.json.skipped.at).toBe(T0);
    expect(sk.json.nextStep).toBe('done');
    expect((await call('GET', '/v1/onboarding', 's_ben')).json.skipped.at).toBe(T0);
    expect((await call('GET', '/v1/onboarding', 's_ana')).status).toBe(200);
    expect((await call('GET', '/v1/onboarding', 's_ana' as string)).json.skipped).toBeNull();
  });

  it('squad choice shares non-calendar items now AND after later imports; calendar is never shared; other members see free/busy only', async () => {
    const { call, canvasDemo, googleDemo, hub } = setup();
    const sq = hub.deps.directory.squadsOf('s_ana')[0]!;
    await canvasDemo();
    const r = await call('POST', '/v1/onboarding/sharing', 's_ana', { squadId: sq, choice: 'squad' });
    expect(r.json.sharedNow).toBeGreaterThan(0);
    await googleDemo(); // imported AFTER the choice: still follows it
    const items = (await call('GET', '/v1/connections/items', 's_ana')).json.items as any[];
    for (const i of items) {
      if (i.kind === 'gcal_event' || i.kind === 'canvas_event') expect(i.sharing).toBe('private');
      else expect(i.sharing).toBe('shared');
    }
    expect(items.find((i) => i.kind === 'classroom_item').sharingLabel).toMatch(/^Shared with /);
    // Ben: shared lecture content is citable, calendar titles are not there at all
    const lecture = (await call('GET', '/v1/context/search?q=' + encodeURIComponent('osmosis water membrane concentration'), 's_ben')).json.results;
    expect(lecture.length).toBeGreaterThan(0);
    expect(lecture.every((x: any) => x.shared === true)).toBe(true);
    const cal = await call('GET', '/v1/context/search?q=' + encodeURIComponent('Climbing wall Rec centre weekly session'), 's_ben');
    expect(cal.json.results.some((x: any) => x.kind === 'gcal_event' || x.kind === 'canvas_event')).toBe(false);
    expect(cal.text).not.toMatch(/Climbing|Rec centre/);
    const ben = await call('GET', '/v1/connections/health', 's_ben');
    expect(ben.text).not.toMatch(/Climbing|STAT 101 lecture|Study group/);
    // busy blocks: start/end only
    const blocks = contextBusyBlocks(hub.deps, 's_ana');
    expect(blocks.length).toBeGreaterThan(4);
    expect(blocks.every((b) => b.title === 'busy')).toBe(true);
    // switching back to private unshares
    await call('POST', '/v1/onboarding/sharing', 's_ana', { squadId: sq, choice: 'private' });
    const after = (await call('GET', '/v1/connections/items', 's_ana')).json.items as any[];
    expect(after.every((i) => i.sharing === 'private')).toBe(true);
    expect((await call('GET', '/v1/context/search?q=osmosis%20membrane', 's_ben')).json.results).toEqual([]);
  });
});

describe('course records, account card, scope words', () => {
  it('every Canvas demo item resolves courseName + courseCode; items, sources, retrieval and citations carry them', async () => {
    const { canvasDemo, call, svc } = setup();
    const c = (await canvasDemo()).json.connection;
    const items = (await call('GET', '/v1/connections/items', 's_ana')).json.items as any[];
    for (const i of items) {
      expect(i.courseName).toBeTruthy();
      expect(i.courseCode).toMatch(/^[A-Z]+ \d+$/);
      expect(i.courseLabel).toBe(`${i.courseCode}: ${i.courseName}`);
    }
    expect(items.some((i) => i.courseLabel === 'HIST 140: Modern World History')).toBe(true);
    expect(items.some((i) => i.courseLabel === 'STAT 101: Introduction to Statistics')).toBe(true);
    const srcs = (await call('GET', `/v1/connections/${c.id}/sources`, 's_ana')).json.sources as any[];
    expect(srcs.every((s) => s.courseName && s.courseCode)).toBe(true);
    // retrieval hit + citation
    const hit = (await call('GET', '/v1/context/search?q=' + encodeURIComponent('monsoon winds ships Indian Ocean'), 's_ana')).json.results[0];
    expect(hit.courseName).toBe('Modern World History');
    expect(hit.courseCode).toBe('HIST 140');
    expect(hit.citation.source.courseName).toBe('HIST 140: Modern World History');
    expect(courseLabel(hit)).toBe('HIST 140: Modern World History');
    // Ask Squad ref
    const ref = (await call('GET', `/v1/chat/context-ref?sourceId=${hit.sourceId}`, 's_ana')).json;
    if (ref?.ref) expect(ref.ref.courseName).toBe('HIST 140: Modern World History');
    // demo due dates: >= 2 within 1-6 days, the rest within 8-14
    const due = items.filter((i) => i.kind === 'canvas_assignment').map((i) => (i.whenAt - T0) / 86_400_000);
    expect(due.filter((d) => d >= 1 && d <= 6.99).length).toBeGreaterThanOrEqual(2);
    expect(due.filter((d) => d > 6.99).every((d) => d >= 8 && d <= 15)).toBe(true);
    // purge removes the course records with the sources
    await call('DELETE', `/v1/connections/${c.id}`, 's_ana');
    expect(svc.store.course(c.id, 'hist140')).toBeUndefined();
  });

  it('demo accounts show a name (never None); scopes come with one-line words', async () => {
    const { canvasDemo, googleDemo } = setup();
    const cv = (await canvasDemo()).json.connection;
    expect(cv.account).toEqual({ label: 'Demo workspace (simulated)', name: 'Demo student' });
    const g = (await googleDemo()).json.connection;
    expect(g.account.name).toBe('Demo student');
    expect(g.grantedScopeLabels).toHaveLength(g.grantedScopes.length);
    expect(g.grantedScopeLabels.every((x: string) => x.length > 10 && !/^Read-only access:/.test(x))).toBe(true);
    expect(cv.grantedScopes).toEqual(['canvas.demo_workspace']);
    expect(cv.grantedScopeLabels[0]).toMatch(/Demo workspace/);
  });

  it('GET /v1/onboarding also answers the flat connected / skippedAt fields the web adapter reads', async () => {
    const { call, canvasDemo } = setup();
    let o = (await call('GET', '/v1/onboarding', 's_ana')).json;
    expect(o).toMatchObject({ connected: false, skippedAt: null });
    await canvasDemo();
    o = (await call('GET', '/v1/onboarding', 's_ana')).json;
    expect(o.connected).toBe(true);
    const sk = (await call('POST', '/v1/onboarding/skip', 's_ben')).json;
    expect(sk).toMatchObject({ skippedAt: T0, connected: false });
  });
});
