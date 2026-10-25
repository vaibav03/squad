import { beforeAll, describe, expect, it } from 'vitest';
import { GOOGLE_SCOPES, hashExternalAccount, normalizeItem, type createFakeGoogleConnector } from '@squad/brain';
import type { HealthCheck, HealthReport } from '@squad/core';
import { createHub } from '../app';
import { signToken } from '../auth';
import { contextServiceFor } from '../context/service';
import { contextBusyBlocks } from '../context/busy';

const SECRET = 'health-test-secret-0123456789abcdef';
const T0 = Date.UTC(2026, 10, 2, 12);
const CANVAS = 'https://canvas.fixture.invalid';
const ALL_GOOGLE = Object.values(GOOGLE_SCOPES);

beforeAll(() => {
  for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'])
    delete process.env[k];
});

function setup() {
  const hub = createHub({
    config: {
      seed: true,
      sim: false,
      authSecret: SECRET,
      logLevel: 'silent',
      baseUrl: 'http://localhost:9060',
      corsOrigins: ['http://localhost:5460'],
      webUrl: 'http://localhost:5460',
      publicWebUrl: 'http://localhost:5460',
    },
    now: () => T0,
  });
  const svc = contextServiceFor(hub.deps);
  const texts: string[] = [];
  const call = async (method: string, path: string, sub: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await hub.app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }, T0).token}`,
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    texts.push(text);
    return { status: res.status, text, json: JSON.parse(text || 'null') as any };
  };
  const health = async (sub = 's_ana', origin = 'http://localhost:5460') => {
    const r = await call('GET', '/v1/connections/health', sub, undefined, { origin });
    expect(r.status).toBe(200);
    const rep = r.json as HealthReport;
    const by = (id: string) => rep.checks.find((c) => c.id === id) as HealthCheck;
    return { rep, by, text: r.text };
  };
  const canvasFixture = () =>
    call('POST', '/v1/connections', 's_ana', {
      provider: 'canvas',
      variant: 'feed',
      scopes: ['canvas.calendar_feed'],
      feedUrl: `${CANVAS}/feeds/calendars/user_x.ics`,
    });
  const googleFixture = () =>
    call('POST', '/v1/connections', 's_ana', { provider: 'google', scopes: ALL_GOOGLE });
  const addItem = (owner: string, kind: any, id: string, title: string, extra: object = {}, text = 'Body text of this item.') => {
    const cid = `c_${owner}_${kind}`;
    if (!svc.store.connection(cid))
      svc.store.upsertConnection({
        id: cid,
        ownerId: owner,
        provider: kind.startsWith('g') ? 'google' : 'canvas',
        mode: 'fixture',
        variant: 'oauth',
        accountHash: hashExternalAccount('p', 'x', cid),
        scopes: [],
        status: 'live',
        degraded: false,
        statusNote: null,
        createdAt: T0,
        lastSyncAt: T0,
        expiresAt: null,
      });
    const { source, pieces } = normalizeItem(
      { ownerId: owner, connectionId: cid, provider: kind.startsWith('g') ? 'google' : 'canvas', mode: 'fixture', now: T0 },
      { externalId: id, kind, title, courseId: 'c1', url: null, modifiedAt: null, ...extra },
      { text },
    );
    svc.store.upsertSource(source, pieces);
    return source;
  };
  return { hub, svc, call, health, canvasFixture, googleFixture, addItem, texts };
}

describe('GET /v1/connections/health', () => {
  it('requires auth and is no-store', async () => {
    const { hub } = setup();
    expect((await hub.app.request('/v1/connections/health')).status).toBe(401);
    const { call } = setup();
    const r = await hub.app.request('/v1/connections/health', {
      headers: { authorization: `Bearer ${signToken(SECRET, { kind: 'bearer', sub: 's_ana', ttlMs: 60_000 }, T0).token}` },
    });
    expect(r.headers.get('cache-control')).toBe('no-store');
    void call;
  });

  it('empty state: every link says why and offers a fix; Google is BLOCKED with the exact env names', async () => {
    const { health, hub: h } = setup();
    const { by, rep } = await health();
    expect(by('canvas_connected')).toMatchObject({ status: 'warn', mode: 'extension not detected' });
    expect(by('canvas_connected').fix).toBeTruthy();
    expect(by('google_connected').status).toBe('blocked');
    expect(by('google_connected').missingEnv).toEqual([
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_OAUTH_REDIRECT_URI',
    ]);
    expect(by('items_visible').status).toBe('warn');
    expect(by('context_retrievable').status).toBe('warn');
    expect(by('trip_availability').status).toBe('warn');
    expect(by('study_plan_persisted').status).toBe('warn');
    // no bot engine attached in a bare hub: an honest fail, then a pass once the engine is attached
    expect(by('cubbie_reachable').status).toBe('fail');
    h.deps.chat.setEngine({} as never);
    expect((await health()).by('cubbie_reachable').status).toBe('pass');
    expect(by('model_provider').mode).toBe('fixture');
    expect(by('imessage_bridge').status).toBe('warn');
    expect(by('sendblue_outbound').status).toBe('blocked');
    expect(rep.overall).toBe('fail'); // the bare hub has no bot engine
    for (const c of rep.checks) expect(c.reason.length).toBeGreaterThan(5);
  });

  it('fixtures are labelled everywhere and the chain passes on fixture data', async () => {
    const { health, canvasFixture, googleFixture } = setup();
    expect((await canvasFixture()).status).toBe(201);
    expect((await googleFixture()).status).toBe(201);
    const { by } = await health();
    expect(by('canvas_connected')).toMatchObject({ status: 'warn', mode: 'fixture' });
    expect(by('canvas_connected').reason).toMatch(/Fixture \(simulated, not your account\)/);
    expect(by('google_connected')).toMatchObject({ status: 'blocked', mode: 'fixture' });
    expect(by('google_connected').reason).toMatch(/Fixture \(simulated, not your account\)/);
    expect(by('canvas_synced')).toMatchObject({ status: 'pass', mode: 'fixture' });
    expect(by('google_synced')).toMatchObject({ status: 'pass', mode: 'fixture' });
    expect(by('items_visible')).toMatchObject({ status: 'pass', mode: 'fixture' });
    expect(by('context_retrievable')).toMatchObject({ status: 'pass', mode: 'fixture' });
    expect(by('context_retrievable').facts?.probeHits).toBeGreaterThan(0);
  });

  it('wrong origin flips redirect_origin to fail; the served origin passes', async () => {
    const { health } = setup();
    expect((await health('s_ana', 'http://localhost:5460')).by('redirect_origin').status).toBe('pass');
    const bad = (await health('s_ana', 'https://evil.example')).by('redirect_origin');
    expect(bad.status).toBe('fail');
    expect(bad.fix).toBeTruthy();
    expect(bad.reason).toMatch(/NOT return here/);
    // a non-5173 loopback port is accepted outside production; nothing is hard-coded to 5173
    const ok = (await health('s_ana', 'http://localhost:5290')).by('redirect_origin');
    expect(ok.facts?.served).toBe('http://localhost:5290');
    expect(ok.status).toBe('warn'); // served :5290 but PUBLIC_WEB_URL says :5460
    expect(ok.reason).toMatch(/5460/);
  });

  it('expired token: google_connected fails with Reconnect and the data is kept', async () => {
    const { health, googleFixture, svc, call, hub } = setup();
    const id = (await googleFixture()).json.connection.id as string;
    const g = svc.connectors.google as ReturnType<typeof createFakeGoogleConnector>;
    g.controls.refreshFails = true;
    svc.store.patchConnection(id, { expiresAt: hub.deps.now() - 1000 });
    const { by } = await health();
    expect(by('google_connected')).toMatchObject({ status: 'fail', mode: 'expired' });
    expect(by('google_connected').fix?.label).toMatch(/Reconnect/);
    expect(svc.store.sourcesOfConnection(id).length).toBeGreaterThan(0);
    void call;
  });

  it('Google killed upstream (revoked): connection purged, items_visible and trip go non-pass', async () => {
    const { health, googleFixture, svc } = setup();
    const id = (await googleFixture()).json.connection.id as string;
    expect((await health()).by('items_visible').status).toBe('pass');
    const g = svc.connectors.google as ReturnType<typeof createFakeGoogleConnector>;
    g.controls.set('revoked');
    await svc.sync('s_ana', id);
    const { by } = await health();
    expect(by('google_connected').status).not.toBe('pass');
    expect(by('items_visible').status).not.toBe('pass');
    expect(by('context_retrievable').status).not.toBe('pass');
    expect(by('trip_availability').status).not.toBe('pass');
  });

  it('extension: absent -> warn; paired -> says so; session account shows host and name', async () => {
    const { health, call, svc } = setup();
    expect((await health()).by('canvas_connected').mode).toBe('extension not detected');
    const p = svc.ext.pair('s_ana');
    const tok = svc.ext.exchange(p.code)!;
    expect((await health()).by('canvas_connected').mode).toMatch(/extension paired/);
    const reg = await call('POST', '/v1/connections/canvas/register', 's_ana', {
      canvas_user_id: '1001',
      canvas_origin: CANVAS,
      name: 'Ana Rivera',
    });
    expect(reg.status).toBe(201);
    expect(reg.json.connection.account).toEqual({ label: 'Ana Rivera @ canvas.fixture.invalid', name: 'Ana Rivera', host: 'canvas.fixture.invalid' });
    expect(reg.json.connection.fixture).toBe(false);
    const { by } = await health();
    expect(by('canvas_connected')).toMatchObject({ status: 'pass', mode: 'extension' });
    expect(by('canvas_synced').status).toBe('warn'); // registered, nothing synced yet: honest
    void tok;
  });

  it('empty retrieval: chunks gone -> context_retrievable is not a pass', async () => {
    const { health, canvasFixture, hub } = setup();
    await canvasFixture();
    expect((await health()).by('context_retrievable').status).toBe('pass');
    hub.deps.db.exec('DELETE FROM ctx_chunks');
    expect((await health()).by('context_retrievable').status).not.toBe('pass');
  });

  it('sendblue links consume deps.sendblue.health() when the provider is installed', async () => {
    const { health, hub } = setup();
    (hub.deps as any).sendblue = {
      health: () => ({
        outbound: { status: 'pass', reason: 'sent' },
        delivery: { status: 'warn', reason: 'delivery receipts delayed' },
        inbound: { status: 'blocked', reason: 'no webhook secret', missingEnv: ['SENDBLUE_WEBHOOK_SECRET'] },
        thread: { status: 'fail', reason: 'reply not in the web thread' },
      }),
    };
    const { by } = await health();
    expect(by('sendblue_outbound').status).toBe('pass');
    expect(by('sendblue_delivery').status).toBe('warn');
    expect(by('sendblue_inbound')).toMatchObject({ status: 'blocked', missingEnv: ['SENDBLUE_WEBHOOK_SECRET'] });
    expect(by('sendblue_thread').status).toBe('fail');
  });

  it('a persisted plan citing an imported item passes study_plan_persisted', async () => {
    const { health, hub } = setup();
    const sq = hub.deps.directory.squadsOf('s_ana')[0]!;
    hub.deps.db.exec(`CREATE TABLE IF NOT EXISTS hub_plans(id TEXT PRIMARY KEY, squad_id TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
    const plan = {
      id: 'p1', squadId: sq, courseId: 'c1', title: 't', status: 'active', items: [{ id: 'i', sources: [] }],
      citations: [{ kind: 'due', label: 'Essay due', source: { kind: 'canvas_assignment', id: 'x' } }],
      generator: { kind: 'agent', mode: 'live' },
    };
    hub.deps.db.prepare('INSERT OR REPLACE INTO hub_plans VALUES(?,?,?,?)').run('p1', sq, JSON.stringify(plan), T0);
    const r = (await health()).by('study_plan_persisted');
    expect(r).toMatchObject({ status: 'pass', mode: 'live' });
    expect(r.facts?.importedCitations).toBe(1);
  });
});

describe('connection view, account identity and items', () => {
  it('fixture accounts say so; no raw e-mail or secret ever appears in any JSON', async () => {
    const { call, canvasFixture, googleFixture, texts } = setup();
    await canvasFixture();
    await googleFixture();
    const list = (await call('GET', '/v1/connections', 's_ana')).json;
    for (const c of list.connections) {
      expect(c.fixture).toBe(true);
      expect(c.account.label).toBe('Demo workspace (simulated)');
      expect(c.importedAt).toBeGreaterThan(0);
    }
    const g = list.connections.find((c: any) => c.provider === 'google');
    expect(g.grantedScopes.sort()).toEqual(['calendar.readonly', 'classroom.courses.readonly', 'classroom.coursework.me.readonly', 'drive.file']);
    const all = texts.join('\n');
    expect(all).not.toMatch(/fixture-refresh-|fixture-access-|refresh_token|accessToken|refreshToken/);
    expect(all).not.toMatch(/@gmail\.com/);
  });

  it('items: timestamps, kind, sharing label; other members never see them; disconnect purges; reconnect works', async () => {
    const { call, googleFixture, hub } = setup();
    const id = (await googleFixture()).json.connection.id as string;
    const sq = hub.deps.directory.squadsOf('s_ana')[0]!;
    const squadName = hub.deps.squads.detail(sq, 's_ana')?.name;
    let items = (await call('GET', '/v1/connections/items', 's_ana')).json;
    expect(items.total).toBeGreaterThan(0);
    expect(items.items[0]).toMatchObject({ provenance: 'fixture', fixture: true, sharing: 'private', sharingLabel: 'Private' });
    expect(items.items[0].fetchedAt).toBeGreaterThan(0);
    expect(items.items[0].kind).toBeTruthy();
    expect((await call('GET', '/v1/connections/items', 's_ben')).json.total).toBe(0);
    const share = await call('POST', `/v1/connections/${id}/share`, 's_ana', { squadId: sq, all: true });
    expect(share.status).toBe(200);
    items = (await call('GET', '/v1/connections/items', 's_ana')).json;
    expect(items.items.some((i: any) => i.sharing === 'shared' && i.sharingLabel === `Shared with ${squadName}`)).toBe(true);
    expect((await call('GET', '/v1/connections/items', 's_ben')).json.total).toBe(0); // items lists own imports only
    const del = await call('DELETE', `/v1/connections/${id}`, 's_ana');
    expect(del.json.status).toBe('revoked');
    expect(del.json.purged.sources).toBeGreaterThan(0);
    expect((await call('GET', '/v1/connections/items', 's_ana')).json.total).toBe(0);
    const after = (await call('GET', '/v1/connections', 's_ana')).json.connections[0];
    expect(after).toMatchObject({ state: 'revoked', account: null, needsReconnect: true });
    const again = await googleFixture();
    expect(again.status).toBe(201);
    expect(again.json.connection.state).toBe('fixture');
    expect((await call('GET', '/v1/connections/items', 's_ana')).json.total).toBeGreaterThan(0);
  });
});

describe('privacy: private calendar details never reach other members', () => {
  it('sentinels stay out of health, items, search, plans-context and trip busy blocks (free/busy only)', async () => {
    const { call, addItem, health, hub, svc } = setup();
    const start = T0 + 86_400_000;
    addItem('s_ana', 'gcal_event', 'e1', 'therapy $180 appointment', { startsAt: start, endsAt: start + 3_600_000 }, 'therapy $180 at the clinic');
    addItem('s_ana', 'canvas_assignment', 'a1', 'Private essay about therapy', { dueAt: start });
    for (const sub of ['s_ben', 's_chi']) {
      const h = await health(sub);
      const items = await call('GET', '/v1/connections/items', sub);
      const search = await call('GET', `/v1/context/search?q=${encodeURIComponent('therapy appointment clinic')}`, sub);
      const blob = [h.text, items.text, search.text].join('\n');
      expect(blob).not.toMatch(/therapy|\$180|clinic/i);
      expect(search.json.results).toEqual([]);
    }
    // the owner's own health response names no titles either (facts and reasons are aggregates)
    const own = await health('s_ana');
    expect(own.text).not.toMatch(/therapy|\$180|clinic/i);
    expect(own.by('trip_availability').status).toBe('pass');
    // busy blocks: start/end with the constant title only
    const blocks = contextBusyBlocks(hub.deps, 's_ana');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.title === 'busy')).toBe(true);
    expect(JSON.stringify(blocks)).not.toMatch(/therapy|\$180/);
    const rows = hub.deps.db.prepare('SELECT * FROM hub_busy_blocks').all();
    expect(JSON.stringify(rows)).not.toMatch(/therapy|\$180/);
    void svc;
  });
});
