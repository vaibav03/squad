import { describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { signToken } from '../auth';
import { createLogger } from '../log';
import { createContextService, contextServiceFor } from '../context/service';
import { GOOGLE_SCOPES } from '@squad/brain';
import { CANVAS_ORIGIN, fakeGoogle } from '@squad/brain/fake-servers';
import { createCanvasClient } from '@squad/brain';
import { fakeCanvas } from '@squad/brain/fake-servers';

const SECRET = 'auth-test';
const G_CFG = {
  clientId: 'CLIENT-ID-PLACEHOLDER',
  clientSecret: 'GOOGLE-CLIENT-SECRET-SENTINEL-93',
  redirectUri: 'http://localhost:8930/oauth/google/callback',
};
const AT = 'GOOGLE-ACCESS-SENTINEL-5e1';
const RT = 'GOOGLE-REFRESH-SENTINEL-8b2';

async function payloadFor(userId = '1001') {
  const client = createCanvasClient({
    credential: { kind: 'session' },
    fetch: fakeCanvas({ session: true, userId: Number(userId) }),
  });
  return client.collect({ origin: CANVAS_ORIGIN, canvasUserId: userId });
}

function setup(opts: { now?: () => number } = {}) {
  const hub = createHub({
    config: {
      seed: true,
      sim: false,
      authSecret: SECRET,
      logLevel: 'silent',
      webUrl: 'http://localhost:5330',
      publicWebUrl: 'http://localhost:5330',
      baseUrl: 'http://localhost:8930',
    },
    ...(opts.now ? { now: opts.now } : {}),
  });
  const lines: string[] = [];
  hub.deps.log = createLogger('debug', (l) => lines.push(l));
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  const bodies: string[] = [];
  const raw = async (method: string, path: string, auth: string | null, body?: unknown) => {
    const res = await hub.app.request(path, {
      method,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      text,
      json: (() => {
        try {
          return JSON.parse(text || 'null') as any;
        } catch {
          return null;
        }
      })(),
    };
  };
  const user = (sub: string) =>
    signToken(SECRET, { kind: 'bearer', sub, ttlMs: 3_600_000 }, hub.deps.now()).token;
  const call = async (method: string, path: string, sub: string | null, body?: unknown) => {
    const r = await raw(method, path, sub ? user(sub) : null, body);
    bodies.push(r.text);
    return r;
  };
  /** Pair the extension for a user: web session mints a code, the extension exchanges it for its own bearer. */
  const pair = async (sub: string) => {
    const code = (await call('POST', '/v1/connections/extension/pair', sub)).json.code as string;
    const ex = await raw('POST', '/v1/connections/extension/token', null, { code });
    return { code, token: ex.json.token as string, status: ex.status };
  };
  const extCall = async (method: string, path: string, token: string, body?: unknown) => {
    const r = await raw(method, path, token, body);
    bodies.push(r.text);
    return r;
  };
  const register = (token: string, over: object = {}) =>
    extCall('POST', '/v1/connections/canvas/register', token, {
      canvas_user_id: '1001',
      canvas_origin: CANVAS_ORIGIN,
      name: 'Sample',
      primary_email: 'sample@fixture.invalid',
      ...over,
    });
  return { hub, lines, bodies, call, raw, pair, extCall, register };
}

describe('Nook parity: extension pairing (Nook phone-code sign-in, adapted)', () => {
  it('web session mints a one-time code, the extension exchanges it for a scoped, revocable bearer', async () => {
    const { call, raw, pair, extCall } = setup();
    expect((await raw('POST', '/v1/connections/extension/pair', null)).status).toBe(401);
    const p = await pair('s_ana');
    expect(p.status).toBe(200);
    expect(p.token).toMatch(/^sqx_/);
    // one time only
    expect(
      (await raw('POST', '/v1/connections/extension/token', null, { code: p.code })).status,
    ).toBe(401);
    expect(
      (await raw('POST', '/v1/connections/extension/token', null, { code: 'WRONG-CODE' })).status,
    ).toBe(401);
    // scoped: it can register Canvas but cannot read the connection list or anything else
    expect((await extCall('GET', '/v1/connections', p.token)).status).toBe(401);
    expect((await extCall('GET', '/v1/context/search?q=x', p.token)).status).toBe(401);
    expect(
      (
        await extCall('POST', '/v1/connections/canvas/register', p.token, {
          canvas_user_id: '1001',
          canvas_origin: CANVAS_ORIGIN,
        })
      ).status,
    ).toBe(201);
    // revocable
    expect((await call('DELETE', '/v1/connections/extension/sessions', 's_ana')).json.revoked).toBe(
      1,
    );
    expect(
      (
        await extCall('POST', '/v1/connections/canvas/register', p.token, {
          canvas_user_id: '1001',
          canvas_origin: CANVAS_ORIGIN,
        })
      ).status,
    ).toBe(401);
  });

  it('a pairing code expires after 10 minutes', async () => {
    let t = 1_000_000;
    const { call, raw } = setup({ now: () => t });
    const code = (await call('POST', '/v1/connections/extension/pair', 's_ana')).json
      .code as string;
    t += 11 * 60_000;
    expect((await raw('POST', '/v1/connections/extension/token', null, { code })).status).toBe(401);
  });
});

describe('Nook parity: Canvas register and sync (apps/mock/src/routes/canvas.ts, store/canvas.ts)', () => {
  it('P7 only exact https, non-local origins; P8 register rules: bound elsewhere, conflict, reactivate', async () => {
    const { pair, register } = setup();
    const ana = (await pair('s_ana')).token;
    const zed = (await pair('s_zed')).token;
    for (const origin of [
      'http://canvas.fixture.invalid',
      `${CANVAS_ORIGIN}/`,
      'https://localhost',
      'https://10.0.0.5',
      'nope',
    ]) {
      const r = await register(ana, { canvas_origin: origin });
      expect(r.status).toBe(400);
      expect(r.json.error.code).toBe('canvas_origin_not_allowed');
    }
    const first = await register(ana);
    expect(first.status).toBe(201);
    expect(first.json.connection).toMatchObject({
      provider: 'canvas',
      variant: 'session',
      mode: 'live',
      state: 'live',
      syncVia: 'extension',
    });
    const again = await register(ana);
    expect(again.status).toBe(200);
    expect(again.json.connection.id).toBe(first.json.connection.id);
    // Same Canvas login claimed by another Squad account: refused, and the owner is not disclosed.
    const bound = await register(zed);
    expect(bound.status).toBe(409);
    expect(bound.json.error.code).toBe('canvas_account_already_bound');
    expect(bound.text).not.toMatch(/s_ana|sample@fixture|Sample/);
    // A different Canvas login on the same origin for the same user is a conflict.
    const conflict = await register(ana, { canvas_user_id: '2002' });
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe('canvas_account_conflict');
  });

  it('P9 sync: 404 not yours, 422 invalid, 409 canvas_session_mismatch, success stores sources', async () => {
    const { pair, register, extCall } = setup();
    const ana = (await pair('s_ana')).token;
    const zed = (await pair('s_zed')).token;
    const id = (await register(ana)).json.connection.id as string;
    const payload = await payloadFor();
    expect((await extCall('POST', `/v1/connections/${id}/canvas-sync`, zed, payload)).status).toBe(
      404,
    );
    expect(
      (await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, { courses: 'x' })).status,
    ).toBe(422);
    const mismatch = await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, {
      ...payload,
      canvas_user_id: '999',
    });
    expect(mismatch.status).toBe(409);
    expect(mismatch.json.error.code).toBe('canvas_session_mismatch');
    expect(
      (
        await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, {
          ...payload,
          origin: 'https://other.fixture.invalid',
        })
      ).status,
    ).toBe(409);
    const ok = await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, payload);
    expect(ok.status).toBe(200);
    expect(ok.json.report).toMatchObject({ outcome: 'ok', pass: 'backfill', added: 6, failed: 0 });
    expect(ok.json.connection).toMatchObject({
      state: 'live',
      lastOutcome: 'ok',
      syncPhase: 'idle',
    });
    expect(ok.json.connection.sources.byKind).toEqual({ canvas_assignment: 3, canvas_file: 3 });
    expect(ok.json.connection.cursor.updatedAt).toBeGreaterThan(0);
    // pushing again is a no-op; removing an assignment upstream removes the derived copy
    const again = await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, payload);
    expect(again.json.report).toMatchObject({ added: 0, unchanged: 6, removed: 0 });
    const fewer = { ...payload, assignments: payload.assignments.slice(1) };
    expect(
      (await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, fewer)).json.report.removed,
    ).toBe(1);
  });

  it('P10 reads: assignments sorted by due_at (nulls last), files filtered by type, invalid type 422, no-store', async () => {
    const { pair, register, extCall, call } = setup();
    const ana = (await pair('s_ana')).token;
    const id = (await register(ana)).json.connection.id as string;
    await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, await payloadFor());
    const a = await call('GET', '/v1/context/canvas/assignments', 's_ana');
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect(a.json.data.map((x: any) => x.name)).toEqual([
      'Problem set 6',
      'Tide pool survey report',
      'Reading reflection',
    ]);
    expect(a.json.data[2].due_at).toBeNull();
    expect(a.json.data[0].source).toMatch(/^source:\/\/canvas_assignment\//);
    const ppt = await call('GET', '/v1/context/canvas/files?type=ppt', 's_ana');
    expect(ppt.json.data.map((f: any) => f.display_name)).toEqual([
      'Lecture 4 - Kelp forests.pptx',
    ]);
    const pdf = await call('GET', '/v1/context/canvas/files?type=pdf', 's_ana');
    expect(pdf.json.data.map((f: any) => f.display_name).sort()).toEqual([
      'Lecture 5 notes.pdf',
      'Syllabus.pdf',
    ]);
    expect((await call('GET', '/v1/context/canvas/files?type=docx', 's_ana')).status).toBe(422);
  });

  it('P21 privacy: another student never reads your Canvas; squad sees it only after an explicit share; calendar never bulk-shared', async () => {
    const { pair, register, extCall, call, hub } = setup();
    const ana = (await pair('s_ana')).token;
    const id = (await register(ana)).json.connection.id as string;
    await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, await payloadFor());
    expect((await call('GET', '/v1/context/canvas/assignments', 's_zed')).json.data).toEqual([]);
    expect(
      (await call('GET', '/v1/context/search?q=tide+pool+survey', 's_zed')).json.results,
    ).toEqual([]);
    expect((await call('GET', `/v1/connections/${id}/sources`, 's_zed')).status).toBe(404);
    expect(
      (
        await call('POST', `/v1/connections/${id}/share`, 's_zed', {
          squadId: 'sq_other',
          all: true,
        })
      ).status,
    ).toBe(404);
    // ana shares with her own squad; zed (other squad) still sees nothing
    await call('POST', `/v1/connections/${id}/share`, 's_ana', { squadId: 'sq_demo', all: true });
    expect(
      (await call('GET', '/v1/context/search?q=tide+pool+survey', 's_zed')).json.results,
    ).toEqual([]);
    const src = contextServiceFor(hub.deps).store.sourcesOfConnection(id)[0]!;
    expect((await call('GET', `/v1/context/source?id=${src.id}`, 's_zed')).status).toBe(404);
  });

  it('expired session / rate limit reported by the extension show honestly everywhere; the next sync recovers', async () => {
    const { pair, register, extCall, call } = setup();
    const ana = (await pair('s_ana')).token;
    const id = (await register(ana)).json.connection.id as string;
    const payload = await payloadFor();
    await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, payload);
    const exp = await extCall('POST', `/v1/connections/${id}/canvas-report`, ana, {
      outcome: 'expired',
    });
    expect(exp.json.connection).toMatchObject({ state: 'expired', lastOutcome: 'expired' });
    expect(exp.json.connection.stateLabel).toMatch(/Expired/);
    // imported data is kept while expired
    expect((await call('GET', '/v1/context/canvas/assignments', 's_ana')).json.data).toHaveLength(
      3,
    );
    const rl = await extCall('POST', `/v1/connections/${id}/canvas-report`, ana, {
      outcome: 'rate_limited',
      retry_after_ms: 90_000,
    });
    expect(rl.json.connection).toMatchObject({ state: 'rate_limited' });
    expect(rl.json.connection.retryAfter).toBeGreaterThan(Date.now());
    expect(
      (await extCall('POST', `/v1/connections/${id}/canvas-report`, ana, { outcome: 'error' })).json
        .connection.state,
    ).toBe('error');
    const back = await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, payload);
    expect(back.json.connection).toMatchObject({
      state: 'live',
      lastOutcome: 'ok',
      retryAfter: null,
    });
    const list = await call('GET', '/v1/connections', 's_ana');
    expect(list.json.connections[0]).toMatchObject({ canSync: false, syncVia: 'extension' });
  });

  it('P12 disconnect purges every derived row, the derived busy blocks and extension access to the connection', async () => {
    const { pair, register, extCall, call, hub } = setup();
    const ana = (await pair('s_ana')).token;
    const id = (await register(ana)).json.connection.id as string;
    await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, await payloadFor());
    const del = await call('DELETE', `/v1/connections/${id}`, 's_ana');
    expect(del.json).toMatchObject({ status: 'revoked', purged: { sources: 6 } });
    expect((await call('GET', '/v1/context/canvas/assignments', 's_ana')).json.data).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) n FROM ctx_chunks').get()).toMatchObject({ n: 0 });
    expect(
      (await extCall('POST', `/v1/connections/${id}/canvas-sync`, ana, await payloadFor())).status,
    ).toBe(409);
    const list = await call('GET', '/v1/connections', 's_ana');
    expect(list.json.connections[0]).toMatchObject({ state: 'revoked' });
    // the same Canvas login can be registered again afterwards
    expect((await register(ana)).status).toBe(201);
  });
});

describe('Nook parity: Google OAuth through the hub (routes/integrations.ts)', () => {
  it('P18 return_to must be relative; P13 simulator when no client is configured, labelled fixture', async () => {
    const { call, raw, hub } = setup();
    expect(
      (await call('GET', '/v1/connections/google/authorize?return_to=https://evil.test/x', 's_ana'))
        .status,
    ).toBe(400);
    expect(
      (await call('GET', '/v1/connections/google/authorize?return_to=//evil.test', 's_ana')).status,
    ).toBe(400);
    const a = await call(
      'GET',
      '/v1/connections/google/authorize?return_to=/squad/connections',
      's_ana',
    );
    expect(a.status).toBe(200);
    expect(a.json.mode).toBe('fixture');
    const url = new URL(a.json.authorization_url);
    expect(url.pathname).toBe('/v1/connections/google/sim-consent');
    const consent = await raw('GET', url.pathname + url.search, null);
    expect(consent.text).toContain('Demo data, not a real Google account');
    const ok = await raw(
      'GET',
      `/oauth/google/callback?state=${encodeURIComponent(url.searchParams.get('state')!)}&code=sim`,
      null,
    );
    expect(ok.status).toBe(302);
    const to = new URL(ok.headers.get('location')!);
    expect(to.origin).toBe('http://localhost:5330');
    expect(to.pathname).toBe('/squad/connections');
    expect(to.searchParams.get('status')).toBe('connected');
    expect(to.searchParams.get('mode')).toBe('fixture');
    const list = await call('GET', '/v1/connections', 's_ana');
    expect(list.json.connections[0]).toMatchObject({
      provider: 'google',
      state: 'fixture',
      mode: 'fixture',
    });
    expect(list.json.connections[0].modeLabel).toMatch(/no real Google account/i);
    // P14: the state is single use
    const replay = await raw(
      'GET',
      `/oauth/google/callback?state=${encodeURIComponent(url.searchParams.get('state')!)}&code=sim`,
      null,
    );
    expect(replay.status).toBe(400);
    expect(replay.json.error.code).toBe('oauth_state_invalid');
    expect((await raw('GET', '/oauth/google/callback?state=nope&code=sim', null)).status).toBe(400);
    expect(hub.deps.db.prepare('SELECT COUNT(*) n FROM ctx_connections').get()).toMatchObject({
      n: 1,
    });
  });

  it('P14 denial redirects with status=error and the message; nothing is stored', async () => {
    const { call, raw, hub } = setup();
    const a = await call('GET', '/v1/connections/google/authorize', 's_ana');
    const state = new URL(a.json.authorization_url).searchParams.get('state')!;
    const r = await raw('GET', `/oauth/google/callback?state=${state}&error=access_denied`, null);
    const to = new URL(r.headers.get('location')!);
    expect(to.searchParams.get('status')).toBe('error');
    expect(Buffer.from(to.searchParams.get('message')!, 'base64url').toString()).toBe(
      'access_denied',
    );
    expect(hub.deps.db.prepare('SELECT COUNT(*) n FROM ctx_connections').get()).toMatchObject({
      n: 0,
    });
  });

  it('live client: PKCE URL, code exchange, granted scopes only, refresh, expired, revoke and purge; no secret escapes', async () => {
    let t = Date.parse('2026-10-25T12:00:00Z');
    const { call, raw, hub, lines, bodies } = setup({ now: () => t });
    const revoked: string[] = [];
    const log: string[] = [];
    const g = fakeGoogle({
      accessToken: AT,
      refreshToken: RT,
      issue: {
        access_token: AT,
        refresh_token: RT,
        expires_in: 3600,
        scope: `openid email ${GOOGLE_SCOPES.calendar} https://www.googleapis.com/auth/gmail.modify`,
      },
      revoked,
      log,
    });
    hub.deps.context = createContextService(hub.deps, { googleOAuth: G_CFG, fetch: g });
    const svc = contextServiceFor(hub.deps);
    expect(svc.mode).toBe('live');

    const a = await call(
      'GET',
      '/v1/connections/google/authorize?return_to=/squad/connections',
      's_ana',
    );
    expect(a.json.mode).toBe('live');
    const u = new URL(a.json.authorization_url);
    expect(u.host).toBe('accounts.google.com');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('client_id')).toBe(G_CFG.clientId);
    expect(a.json.authorization_url).not.toContain(G_CFG.clientSecret);
    const state = u.searchParams.get('state')!;
    // the simulator is off once a client is configured
    expect(
      (await raw('GET', `/v1/connections/google/sim-consent?state=${state}`, null)).status,
    ).toBe(404);
    expect(
      (await raw('GET', `/oauth/google/callback?state=${state}&code=sim`, null)).headers.get(
        'location',
      ),
    ).toContain('status=error');
    const state2 = new URL(
      (await call('GET', '/v1/connections/google/authorize', 's_ana')).json.authorization_url,
    ).searchParams.get('state')!;
    const cb = await raw('GET', `/oauth/google/callback?state=${state2}&code=good-code`, null);
    expect(new URL(cb.headers.get('location')!).searchParams.get('status')).toBe('connected');

    let list = (await call('GET', '/v1/connections', 's_ana')).json.connections;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ provider: 'google', mode: 'live', state: 'live' });
    // Google granted calendar + gmail.modify: only the allowed, minimal scope is kept.
    expect(list[0].scopes).toEqual([GOOGLE_SCOPES.calendar]);
    expect(list[0].sources.byKind).toEqual({ gcal_event: 2 });
    const id = list[0].id as string;

    // refresh within 60 s of expiry
    t += 3_600_000 - 30_000;
    await call('GET', '/v1/connections', 's_ana');
    expect(log.some((l) => l.includes('oauth2.googleapis.com/token'))).toBe(true);
    // reconnecting the same Google account refreshes the grant, it never duplicates the connection
    const state3 = new URL(
      (await call('GET', '/v1/connections/google/authorize', 's_ana')).json.authorization_url,
    ).searchParams.get('state')!;
    await raw('GET', `/oauth/google/callback?state=${state3}&code=good-code`, null);
    list = (await call('GET', '/v1/connections', 's_ana')).json.connections;
    expect(list).toHaveLength(1);

    // refresh refused (not "revoked") -> expired, data KEPT, no upstream sync call
    const dead = fakeGoogle({ accessToken: AT, refreshToken: RT, refreshRefused: true });
    hub.deps.context = createContextService(hub.deps, { googleOAuth: G_CFG, fetch: dead });
    t += 3_600_000;
    list = (await call('GET', '/v1/connections', 's_ana')).json.connections;
    expect(list[0]).toMatchObject({ state: 'expired' });
    expect(list[0].sources.total).toBe(2);
    expect((await call('POST', `/v1/connections/${id}/sync`, 's_ana')).json.error.code).toBe(
      'connection_expired',
    );

    // disconnect revokes at Google (best effort) and purges
    hub.deps.context = createContextService(hub.deps, { googleOAuth: G_CFG, fetch: g });
    const del = await call('DELETE', `/v1/connections/${id}`, 's_ana');
    expect(del.json).toMatchObject({ status: 'revoked', purged: { sources: 2 } });
    expect(revoked).toEqual(['revoked']);

    // reconnect imports again; then Google answers invalid_grant on refresh -> revoked, data purged, honest message
    const state4 = new URL(
      (await call('GET', '/v1/connections/google/authorize', 's_ana')).json.authorization_url,
    ).searchParams.get('state')!;
    await raw('GET', `/oauth/google/callback?state=${state4}&code=good-code`, null);
    const live = (await call('GET', '/v1/connections', 's_ana')).json.connections.find(
      (x: { state: string }) => x.state === 'live',
    );
    expect(live.sources.total).toBe(2);
    // the access token dies at Google early: one refresh, one retry, no user-visible failure
    const tlog: string[] = [];
    const rotated = fakeGoogle({
      accessToken: 'AT-ROTATED',
      refreshToken: RT,
      issue: { access_token: 'AT-ROTATED' },
      log: tlog,
    });
    hub.deps.context = createContextService(hub.deps, { googleOAuth: G_CFG, fetch: rotated });
    const healed = await call('POST', `/v1/connections/${live.id}/sync`, 's_ana');
    expect(healed.status).toBe(200);
    expect(healed.json.sync.outcome).toBe('ok');
    expect(healed.json.connection).toMatchObject({ state: 'live', needsReconnect: false });
    expect(tlog.filter((l) => l.includes('oauth2.googleapis.com/token'))).toHaveLength(1);

    const gone = fakeGoogle({ accessToken: AT, refreshToken: RT, refreshInvalidGrant: true });
    hub.deps.context = createContextService(hub.deps, { googleOAuth: G_CFG, fetch: gone });
    t += 3_600_000;
    const after = (await call('GET', '/v1/connections', 's_ana')).json.connections.find(
      (x: { id: string }) => x.id === live.id,
    );
    expect(after).toMatchObject({
      state: 'revoked',
      needsReconnect: true,
      stateLabel:
        'Google access was revoked. Imported data was removed. Reconnect to import again.',
    });
    expect(after.sources.total).toBe(0);

    // P20 sentinel scan: responses, logs, the redirect URLs, and every plaintext table
    const secrets = [G_CFG.clientSecret, AT, RT];
    for (const h of [...bodies, ...lines]) for (const s of secrets) expect(h).not.toContain(s);
    const tables = (
      hub.deps.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((x) => x.name);
    for (const tname of tables) {
      const dump = Buffer.from(
        JSON.stringify(hub.deps.db.prepare(`SELECT * FROM ${tname}`).all()),
      ).toString('latin1');
      for (const s of secrets) expect(dump, tname).not.toContain(s);
    }
  });

  it('live Google rate limit and quota -> rate_limited with a retry time, data kept', async () => {
    const t = Date.parse('2026-10-25T12:00:00Z');
    const { call, raw, hub } = setup({ now: () => t });
    const cfg = {
      accessToken: AT,
      refreshToken: RT,
      issue: { access_token: AT, refresh_token: RT, scope: GOOGLE_SCOPES.calendar },
    };
    hub.deps.context = createContextService(hub.deps, {
      googleOAuth: G_CFG,
      fetch: fakeGoogle(cfg),
    });
    const state = new URL(
      (await call('GET', '/v1/connections/google/authorize', 's_ana')).json.authorization_url,
    ).searchParams.get('state')!;
    await raw('GET', `/oauth/google/callback?state=${state}&code=good-code`, null);
    const id = (await call('GET', '/v1/connections', 's_ana')).json.connections[0].id as string;
    hub.deps.context = createContextService(hub.deps, {
      googleOAuth: G_CFG,
      fetch: fakeGoogle({ ...cfg, rateLimitSeconds: 300 }),
    });
    const r = await call('POST', `/v1/connections/${id}/sync`, 's_ana');
    expect(r.json.sync.outcome).toBe('rate_limited');
    expect(r.json.connection).toMatchObject({ state: 'rate_limited', retryAfter: t + 300_000 });
    expect(r.json.connection.sources.total).toBe(2);
  });
});

describe('Calendar privacy: only derived busy blocks, purged on disconnect', () => {
  it('connected calendar events become title-less busy blocks; disconnect removes them', async () => {
    const t = Date.UTC(2026, 9, 25, 12);
    const { call, hub, bodies } = setup({ now: () => t });
    const c = await call('POST', '/v1/connections', 's_ana', {
      provider: 'google',
      scopes: [GOOGLE_SCOPES.calendar],
    });
    expect(c.status).toBe(201);
    const rows = () =>
      hub.deps.db
        .prepare("SELECT start, end, title FROM hub_busy_blocks WHERE student='s_ana'")
        .all() as { title: string }[];
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => r.title === 'busy')).toBe(true);
    // The event titles live only in the owner-private, purgeable context store.
    const titles = (
      hub.deps.db.prepare("SELECT title FROM ctx_sources WHERE kind='gcal_event'").all() as {
        title: string;
      }[]
    ).map((x) => x.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows())).not.toContain(titles[0]!);
    const exp = await call('GET', '/v1/auth/export', 's_ana');
    bodies.push(exp.text);
    await call('DELETE', `/v1/connections/${c.json.connection.id}`, 's_ana');
    expect(rows()).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) n FROM ctx_sources').get()).toMatchObject({ n: 0 });
  });
});
