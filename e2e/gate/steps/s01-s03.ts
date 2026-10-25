/* eslint-disable @typescript-eslint/no-explicit-any -- the gate reads untyped hub JSON */
// S1 connect, S2 ingest, S3 retrieve. Asserts the REAL feature (feature/nook-parity on feature/context-store):
// docs/context-store.md, docs/nook-parity.md, apps/hub/src/routes/connections.ts. Routes live in lib/contract.ts.
//
// What the fixture run can and cannot prove (see the report): the hub's fixture upstreams are in-process fakes that read
// packages/brain/fixtures/connectors/*.json, Google consent is the hub's labelled simulator, and a context-grounded chat
// answer needs a real model (the demo LLM does not serve the context-claims prompt). Those limits are noted, not hidden.
import { P } from '../lib/probes';
import { SENTINELS, WEB } from '../lib/config';
import { api } from '../lib/hub';
import { im } from '../lib/fakes/client';
import { HUB_FIXTURE, FACTS, PRIVATE_FIXTURE } from '../lib/fakes/content';
import {
  CALENDAR_KINDS,
  CANVAS_ALLOWED,
  CANVAS_FIXTURE_BASE,
  CANVAS_SCOPE,
  CANVAS_SECRET,
  FORBIDDEN_SCOPE,
  GOOGLE_ALLOWED,
  GOOGLE_SCOPE,
  NOT_IN_MATERIALS,
  ROUTES,
} from '../lib/contract';
import { RAW_ID_PATTERNS, defaultSentinels } from '../lib/asserts';
import { citationKeys } from '../lib/cites';
import type { Probe } from '../lib/types';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { openGroupChat } from '../lib/hub';
import {
  asSet,
  ask,
  connectCanvas,
  connectGoogle,
  dbRows,
  disconnect,
  ensureConnected,
  items,
  listConnections,
  openSource,
  optIn,
  resetUpstreams,
  searchContext,
  shareToSquad,
  syncAll,
} from './flows';

/** The Nook-parity routes (Google authorize/callback, canvas register, connection views). Move into lib/probes.ts. */
const P_NOOK: Probe = {
  owner: 'feature/nook-parity',
  files: [
    { path: 'apps/hub/src/routes/connections.ts', contains: '/oauth/google/callback' },
    { path: 'packages/brain/src/context/parity/fake-servers.ts' },
  ],
  why: 'Nook-parity connections: /v1/connections*, Google authorize + callback, context search and source viewer',
};

/** Secrets and credential-shaped strings that must never appear in a response, the DOM, storage or the database. */
const SECRETS = [
  SENTINELS.feedSecret,
  SENTINELS.refreshToken,
  CANVAS_SECRET,
  'fixture-refresh-',
  'fixture-access-',
];
/** What a squad surface must never show: the unpicked Drive file and the private calendar titles. */
const PRIVATE = [...defaultSentinels(), ...PRIVATE_FIXTURE];
const ID_PATTERNS_NO_PHONE = RAW_ID_PATTERNS.filter(([n]) => n !== 'phone number'); // ISO dates look like phone numbers

const byKind = (rows: { kind: string }[]) => {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = (out[r.kind] ?? 0) + 1;
  return out;
};
const blobLen = (x: any): number =>
  x?.data?.length ?? (x && typeof x === 'object' ? Object.keys(x).length : String(x ?? '').length);

export const S1: StepDef<GateCtx> = {
  id: 'S1',
  title: 'Connect Canvas and Google Workspace with minimal permissions',
  needs: [P.context, P_NOOK],
  realNeeds: ['google_client', 'google_account', 'canvas_feed'],
  label:
    'fixture (hub simulator and in-process fixture upstreams; no real Google or Canvas account)',
  fixture: async (c, a) => {
    const u = c.world.users.rhea;
    const cy = c.world.users.cy;
    const ben = c.world.users.ben;
    await resetUpstreams();

    // 0. what the hub declares, against an independent oracle
    const l0 = await listConnections(u);
    a.eq('GET /v1/connections is 200', l0.status, 200);
    a.eq('hub runs in fixture mode (no Google OAuth client configured)', l0.mode, 'fixture');
    a.eq(
      'hub declares exactly the minimal Google scopes',
      asSet(l0.allowedScopes.google ?? []),
      asSet(GOOGLE_ALLOWED),
    );
    a.eq(
      'hub declares exactly the Canvas scopes',
      asSet(l0.allowedScopes.canvas ?? []),
      asSet(CANVAS_ALLOWED),
    );
    a.ok(
      'no declared scope is a bulk or write grant',
      ![...(l0.allowedScopes.google ?? []), ...(l0.allowedScopes.canvas ?? [])].some((s) =>
        FORBIDDEN_SCOPE.test(s),
      ),
    );
    a.eq(
      'nothing is connected before the user connects',
      l0.connections.filter((x) => x.status !== 'revoked').length,
      0,
    );

    // 1. refusals: broad scopes, honest live mode, bad URLs
    const refuse = async (name: string, json: object, status: number, code: string, user = u) => {
      const r = await api(user.token, ROUTES.connections, { method: 'POST', json });
      a.ok(
        name,
        r.status === status && r.json?.error?.code === code,
        `got ${r.status} ${r.json?.error?.code}`,
      );
    };
    const tok = { token: CANVAS_SECRET, baseUrl: CANVAS_FIXTURE_BASE };
    await refuse(
      'bulk Drive scope is refused',
      { provider: 'google', scopes: ['https://www.googleapis.com/auth/drive'] },
      400,
      'scope_not_allowed',
    );
    await refuse(
      'Gmail scope is refused',
      { provider: 'google', scopes: ['https://mail.google.com/'] },
      400,
      'scope_not_allowed',
    );
    await refuse(
      'an allowed scope mixed with a bulk one is refused whole',
      {
        provider: 'google',
        scopes: [GOOGLE_SCOPE.calendar, 'https://www.googleapis.com/auth/drive.readonly'],
      },
      400,
      'scope_not_allowed',
    );
    await refuse(
      'Google "live" without an OAuth client is refused honestly',
      { provider: 'google', scopes: [GOOGLE_SCOPE.calendar], mode: 'live' },
      501,
      'live_not_available',
    );
    await refuse(
      'Canvas refuses a Google scope',
      { provider: 'canvas', variant: 'token', scopes: [GOOGLE_SCOPE.calendar], ...tok },
      400,
      'scope_not_allowed',
    );
    await refuse(
      'Canvas feed must be https',
      {
        provider: 'canvas',
        variant: 'feed',
        scopes: [CANVAS_SCOPE.feed],
        feedUrl: 'http://canvas.fixture.invalid/a.ics',
      },
      400,
      'invalid_request',
    );
    await refuse(
      'Canvas feed on loopback is refused (SSRF guard)',
      {
        provider: 'canvas',
        variant: 'feed',
        scopes: [CANVAS_SCOPE.feed],
        feedUrl: 'https://localhost/a.ics',
      },
      400,
      'invalid_request',
    );
    a.eq(
      'unauthenticated connect is 401',
      (await api(null, ROUTES.connections, { method: 'POST', json: {} })).status,
      401,
    );

    // 2. Canvas (student token variant, fixture mode)
    const cv = await connectCanvas(u);
    a.eq('Canvas connect is accepted (201)', cv.status, 201);
    a.noLeak('Canvas connect response', cv.text, SECRETS);
    const cview = cv.json?.connection;
    a.eq('Canvas granted scopes equal exactly its one allowed scope', cview?.scopes, [
      CANVAS_SCOPE.token,
    ]);
    a.eq('Canvas connection says mode fixture', cview?.mode, 'fixture');
    a.eq('Canvas connection state is fixture (never "live")', cview?.state, 'fixture');
    a.ok(
      'Canvas mode label is honest',
      /demo data/i.test(cview?.modeLabel ?? '') &&
        /no real canvas account/i.test(cview?.modeLabel ?? ''),
      String(cview?.modeLabel),
    );
    a.ok(
      'first sync ran on connect and imported sources',
      cv.json?.sync?.outcome === 'ok' && cv.json?.sync?.added > 0,
      JSON.stringify(cv.json?.sync),
    );
    a.eq(
      'connecting the same Canvas account twice is refused',
      (await connectCanvas(u)).json?.error?.code,
      'already_connected',
    );

    // 3. Google through the Nook-shaped consent dance (authorize -> consent -> callback)
    const g = await connectGoogle(u, { replayCallback: true });
    if (!g.ok) a.fail('google consent flow', g.why);
    else {
      a.eq('authorize reports mode fixture', g.mode, 'fixture');
      a.eq(
        'hub requests exactly the allowed Google scopes',
        asSet(g.requested),
        asSet(GOOGLE_ALLOWED),
      );
      a.eq(
        'consent page lists exactly the allowed scopes',
        asSet(g.consentScopes),
        asSet(GOOGLE_ALLOWED.map((s) => s.split('/').pop()!)),
      );
      a.ok(
        'consent page labels itself as demo, not a real Google account',
        /demo data, not a real google account/i.test(g.consentHtml),
      );
      a.eq('callback redirects (302)', g.callbackStatus, 302);
      let loc: URL | undefined;
      try {
        loc = new URL(g.location);
      } catch {
        /* not a URL */
      }
      a.ok(
        'callback returns to the web app',
        loc?.origin === new URL(WEB).origin && loc?.pathname === '/squad/connections',
        g.location,
      );
      a.eq('callback reports status=connected', loc?.searchParams.get('status'), 'connected');
      a.eq('callback reports mode=fixture', loc?.searchParams.get('mode'), 'fixture');
      a.eq('OAuth state is single use (replay is 400)', g.replayStatus, 400);
    }
    a.eq(
      'a bogus OAuth state is refused',
      (await api(null, `${ROUTES.googleCallback}?state=nope&code=sim`)).status,
      400,
    );
    a.eq(
      'an absolute return_to is refused',
      (
        await api(
          u.token,
          `${ROUTES.googleAuthorize}?return_to=${encodeURIComponent('https://evil.example/x')}`,
        )
      ).status,
      400,
    );
    const denied = await connectGoogle(u, { deny: true });
    a.ok(
      'cancelling consent redirects with status=error',
      denied.ok && /status=error/.test(denied.location),
      denied.ok ? denied.location : denied.why,
    );
    await connectGoogle(u); // reconnect the same account: an upsert, never a duplicate
    const l1 = await listConnections(u);
    const canvasC = l1.connections.filter((x) => x.provider === 'canvas' && x.status !== 'revoked');
    const googleC = l1.connections.filter((x) => x.provider === 'google' && x.status !== 'revoked');
    a.eq('exactly one Canvas connection', canvasC.length, 1);
    a.eq('reconnecting Google keeps exactly one connection', googleC.length, 1);
    const gv = googleC[0];

    // 4. what was granted
    a.eq(
      'granted Google scopes equal exactly the allowed set',
      asSet(gv?.scopes ?? []),
      asSet(GOOGLE_ALLOWED),
    );
    a.ok(
      'no granted scope is a bulk or write grant',
      ![...(gv?.scopes ?? []), ...(canvasC[0]?.scopes ?? [])].some((s) => FORBIDDEN_SCOPE.test(s)),
    );
    a.eq(
      'Drive access is per file only (drive.file, nothing else with "drive")',
      (gv?.scopes ?? []).filter((s) => /drive/.test(s)),
      [GOOGLE_SCOPE.drive],
    );
    a.ok(
      'Calendar is read-only',
      (gv?.scopes ?? []).includes(GOOGLE_SCOPE.calendar) &&
        !(gv?.scopes ?? []).some((s) => /calendar(\.events)?$/.test(s)),
    );
    a.eq('Google connection says mode fixture', gv?.mode, 'fixture');
    a.eq('Google connection state is fixture (never "live")', gv?.state, 'fixture');
    a.ok(
      'Google mode label is honest',
      /demo data/i.test(gv?.modeLabel ?? '') && /no real google account/i.test(gv?.modeLabel ?? ''),
      String(gv?.modeLabel),
    );
    a.ok(
      'Google state label says demo data, not a real account',
      /demo data, not a real account/i.test(gv?.stateLabel ?? ''),
      String(gv?.stateLabel),
    );
    a.eq('Google variant is oauth', gv?.variant, 'oauth');

    // 5. no secret echoed, encrypted at rest
    a.noLeak('connections list', l1.text, SECRETS);
    a.ok(
      'connection view carries no credential, account or hash field',
      !/accountHash|accessToken|refreshToken|feedUrl|"token"|"baseUrl"/i.test(
        JSON.stringify(l1.connections),
      ),
    );
    a.noLeak('/v1/status', (await api(null, ROUTES.status)).text, SECRETS);
    const dump = await im.dbDump();
    a.ok('Canvas token is nowhere in the database in plaintext', !dump.includes(CANVAS_SECRET));
    a.ok(
      'Google credentials are nowhere in the database in plaintext',
      !dump.includes('fixture-refresh-') && !dump.includes('fixture-access-'),
    );
    a.ok(
      'raw upstream account ids are never stored (salted hash only)',
      !HUB_FIXTURE.rawAccountIds.some((id) => dump.includes(id)),
    );
    const rows = (await dbRows('ctx_connections')).filter(
      (r) => String(r.owner_id) === u.id && r.status !== 'revoked',
    );
    a.eq('two connection rows exist for the user', rows.length, 2);
    a.ok(
      'account hashes are digests, not ids',
      rows.length > 0 && rows.every((r) => /^[0-9a-f]{32}$/.test(String(r.account_hash))),
    );
    const toks = await dbRows('ctx_tokens');
    a.ok(
      'each connection has an encrypted token row',
      rows.length > 0 &&
        rows.every((r) =>
          toks.some((t) => t.connection_id === r.id && blobLen(t.ct) > 0 && blobLen(t.iv) === 12),
        ),
    );

    // 6. Nook's browser-session path: register rules (a second user, so the main journey is unaffected)
    const reg = (user: typeof u, origin: string, id: string) =>
      api(user.token, ROUTES.canvasRegister, {
        method: 'POST',
        json: { canvas_user_id: id, canvas_origin: origin },
      });
    const r1 = await reg(cy, CANVAS_FIXTURE_BASE, '4242');
    a.ok(
      'session register creates a connection',
      r1.status === 201 && r1.json?.connection?.variant === 'session' && r1.json?.created === true,
      `status ${r1.status}`,
    );
    a.eq('session connection holds exactly the session scope', r1.json?.connection?.scopes, [
      CANVAS_SCOPE.session,
    ]);
    a.ok(
      'session connection says it syncs from the browser extension',
      /browser session/i.test(r1.json?.connection?.modeLabel ?? '') &&
        r1.json?.connection?.syncVia === 'extension',
    );
    const r2 = await reg(ben, CANVAS_FIXTURE_BASE, '4242');
    a.ok(
      'the same Canvas login cannot be bound to a second Squad account',
      r2.status === 409 && r2.json?.error?.code === 'canvas_account_already_bound',
      `got ${r2.status}`,
    );
    a.ok('and the owner is not disclosed', !r2.text.includes(cy.id));
    const r3 = await reg(cy, 'http://canvas.fixture.invalid', '4242');
    a.ok(
      'only exact https origins are accepted',
      r3.status === 400 && r3.json?.error?.code === 'canvas_origin_not_allowed',
      `got ${r3.status}`,
    );
    const sid: string | undefined = r1.json?.connection?.id;
    if (sid) {
      const bad = await api(cy.token, ROUTES.canvasSync(sid), {
        method: 'POST',
        json: {
          origin: 'https://other.fixture.invalid',
          canvas_user_id: '4242',
          courses: [],
          assignments: [],
          files: [],
        },
      });
      a.ok(
        'a payload for a different Canvas origin is refused',
        bad.status === 409 && bad.json?.error?.code === 'canvas_session_mismatch',
        `got ${bad.status}`,
      );
      a.eq(
        'another user cannot sync it (404, not 403)',
        (await api(ben.token, ROUTES.canvasSync(sid), { method: 'POST', json: {} })).status,
        404,
      );
      await disconnect(cy, sid);
      await disconnect(cy, sid, { remove: true });
    }

    // 7. what the browser saw
    if (c.actors.rhea) {
      const page = c.actors.rhea.page;
      await page.goto('/squad/connections');
      const card = page.locator('article[aria-label="canvas connection"]');
      const shown = await card.waitFor({ timeout: 15_000 }).then(
        () => true,
        () => false,
      );
      a.ok('web Connections page shows the Canvas card', shown);
      const text = await page
        .locator('body')
        .innerText()
        .catch(() => '');
      a.ok(
        'web shows the Google card',
        await page
          .locator('article[aria-label="google connection"]')
          .count()
          .then((n) => n > 0),
      );
      a.ok(
        'web labels the data honestly as demo data, not a real account',
        /demo data, not a real account/i.test(text),
      );
      a.ok(
        'web explains Drive access in plain words (only picked files)',
        /only the drive files you pick/i.test(text),
      );
      a.noLeak('Connections page text', text, SECRETS);
      a.ok(
        'no raw ids on the Connections page',
        !ID_PATTERNS_NO_PHONE.some(([, re]) => re.test(text)),
        ID_PATTERNS_NO_PHONE.filter(([, re]) => re.test(text))
          .map(([n]) => n)
          .join(', '),
      );
      a.noLeak('web responses', c.actors.rhea.bodies.join('\n'), SECRETS);
      const ls = await page
        .evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
        .catch(() => '');
      a.noLeak('web storage', ls, SECRETS);
      await a.shot(page, 'connections');
    }
  },
};

export const S2: StepDef<GateCtx> = {
  id: 'S2',
  title: 'Ingest and normalize permitted context',
  needs: [P.context, P_NOOK],
  realNeeds: ['google_client', 'canvas_feed'],
  label: 'fixture (in-process fixture upstreams; no real Google or Canvas account)',
  fixture: async (c, a) => {
    const u = c.world.users.rhea;
    const ben = c.world.users.ben;
    const dan = c.world.users.dan;
    const squad = c.world.squadA.id;
    if (await ensureConnected(u))
      a.note('S2 connected the accounts itself (S1 did not leave them connected)');
    const conns = (await listConnections(u)).connections.filter((x) => x.status !== 'revoked');

    // normalized sources
    const first = await items(u);
    const kinds = byKind(first);
    for (const [k, n] of Object.entries({
      ...HUB_FIXTURE.canvas.counts,
      ...HUB_FIXTURE.google.counts,
    }))
      a.eq(`${n} ${k} source(s) imported`, kinds[k] ?? 0, n);
    a.eq(
      'no Drive file beyond the picked one (drive.file is per file)',
      (kinds.gdoc ?? 0) + (kinds.gdrive_file ?? 0),
      1,
    );
    a.ok(
      'the picked Drive file is the one imported',
      first.some((s) => s.kind === 'gdoc' && s.title === HUB_FIXTURE.google.picked.title),
    );
    a.ok(
      'the unpicked Drive file was never imported',
      !first.some((s) => s.title === HUB_FIXTURE.google.unpicked.title),
    );
    a.ok(
      'every source has an https deep link to its origin',
      first.length > 0 && first.every((s) => /^https:\/\//.test(String(s.url))),
    );
    a.ok(
      'every source says it is fixture data',
      first.every((s) => String(s.provenance).endsWith(':fixture')),
    );
    a.ok(
      'every source starts private and shared with nobody',
      first.every((s) => s.visibility === 'private' && s.sharedWith.length === 0),
    );
    const dbSources = (await dbRows('ctx_sources')).filter((r) => String(r.owner_id) === u.id);
    const chunks = await dbRows('ctx_chunks');
    a.eq('API and database agree on the source count', dbSources.length, first.length);
    a.ok(
      'stable ids: src_ + 24 hex',
      dbSources.every((r) => /^src_[0-9a-f]{24}$/.test(String(r.id))),
    );
    a.ok(
      'every source has a sha-256 contentHash and a source:// uri',
      dbSources.every(
        (r) =>
          /^[0-9a-f]{64}$/.test(String(r.content_hash)) && String(r.uri).startsWith('source://'),
      ),
    );
    a.ok(
      'every source is chunked with a stable anchor and non-empty text',
      dbSources.every((r) =>
        chunks.some((k) => k.source_id === r.id && k.anchor && String(k.text).trim().length > 0),
      ),
    );
    const day = 24 * 3_600_000;
    a.ok(
      'derived data carries a retention date (about 180 days)',
      dbSources.every(
        (r) =>
          r.expires_at && Math.abs(Number(r.expires_at) - Number(r.fetched_at) - 180 * day) < day,
      ),
    );
    a.ok(
      'items are private in the database too (no share rows yet)',
      (await dbRows('ctx_shares')).filter((s) => dbSources.some((r) => r.id === s.source_id))
        .length === 0,
    );

    // idempotent re-sync
    const hashes = (rows: any[]) => rows.map((r) => `${r.id}:${r.content_hash}`).sort();
    const before = hashes(dbSources);
    const sync = await syncAll(u);
    a.ok(
      'manual re-sync accepted for every hub-synced connection',
      sync.ok,
      `status ${sync.status}`,
    );
    a.ok(
      're-sync reports nothing added, removed or failed',
      sync.results.every(
        (r) =>
          r.json?.sync?.added === 0 && r.json?.sync?.removed === 0 && r.json?.sync?.failed === 0,
      ),
      JSON.stringify(sync.results.map((r) => r.json?.sync)),
    );
    const second = await items(u);
    a.eq('re-sync is idempotent (count unchanged)', second.length, first.length);
    a.eq(
      're-sync keeps ids and content hashes',
      hashes((await dbRows('ctx_sources')).filter((r) => String(r.owner_id) === u.id)),
      before,
    );
    c.state.canvasItemIds = first.filter((s) => s.kind.startsWith('canvas_')).map((s) => s.id);

    // what was never stored
    const dump = await im.dbDump();
    a.ok(
      'unpicked Drive file (name and text) is never stored',
      !dump.includes(HUB_FIXTURE.google.unpicked.title) &&
        !dump.includes(HUB_FIXTURE.google.unpicked.textNeedle),
    );
    a.ok('no grade string is stored', !dump.includes(SENTINELS.grade));
    a.ok(
      'no credential-shaped string is stored in plaintext',
      !SECRETS.some((s) => dump.includes(s)),
    );
    const busy = (await dbRows('hub_busy_blocks')).filter((r) => r.student === u.id);
    const busyJson = JSON.stringify(busy);
    a.ok(
      'busy blocks hold no titles',
      busy.every((r) => r.title === 'busy') &&
        !HUB_FIXTURE.google.eventTitles.some((t) => busyJson.includes(t)) &&
        !/study group|office hours/i.test(busyJson),
    );
    if (Date.now() < Date.parse('2026-10-31T00:00:00Z'))
      a.ok(
        'busy blocks were derived from the connected calendars',
        busy.length >= 1,
        `rows ${busy.length}`,
      );
    else a.note('fixture calendar events are in the past: busy-block derivation not asserted');

    // privacy before sharing
    a.eq(
      'squad member has no connections of their own to see',
      (await listConnections(ben)).connections.length,
      0,
    );
    a.eq(
      'squad search returns nothing while nothing is shared',
      (await items(ben, squad)).length,
      0,
    );
    a.eq(
      '...also with no squad header',
      (await searchContext(ben, 'sampling distributions assignment')).results.length,
      0,
    );
    const conn0 = conns[0];
    if (conn0) {
      a.eq(
        "another member cannot list a connection's sources (404)",
        (await api(ben.token, ROUTES.connectionSources(conn0.id))).status,
        404,
      );
      a.eq(
        'another member cannot sync it (404)',
        (await api(ben.token, ROUTES.connectionSync(conn0.id), { method: 'POST', json: {} }))
          .status,
        404,
      );
      a.eq(
        'another member cannot share it (404)',
        (
          await api(ben.token, ROUTES.connectionShare(conn0.id), {
            method: 'POST',
            json: { squadId: squad, all: true },
          })
        ).status,
        404,
      );
      a.eq(
        'another member cannot disconnect it (404)',
        (await api(ben.token, ROUTES.connection(conn0.id), { method: 'DELETE' })).status,
        404,
      );
    }
    const aSrc = first.find((s) => s.kind === 'canvas_assignment')!;
    const peek = await openSource(ben, { id: aSrc.id });
    const ghost = await openSource(ben, { id: 'src_000000000000000000000000' });
    a.ok(
      'a private source looks exactly like a missing one to others',
      peek.status === 404 && peek.text === ghost.text,
      `${peek.status} vs ${ghost.status}`,
    );
    a.eq(
      'sharing into a squad the owner is not in is refused (404)',
      (await shareToSquad(u, 'sq_not_mine', { all: true })).every((r) => r.status === 404),
      true,
    );

    // per-squad share
    const nonCal = first.filter((s) => !CALENDAR_KINDS.has(s.kind));
    const sh = await shareToSquad(u, squad, { all: true });
    a.ok('share all accepted', sh.length === conns.length && sh.every((r) => r.status === 200));
    a.eq(
      'share all covers every non-calendar source (3+1 Canvas, 1 Drive doc, 1 Classroom item)',
      sh.reduce((n, r) => n + (r.json?.count ?? 0), 0),
      nonCal.length,
    );
    const shares1 = (await dbRows('ctx_shares')).length;
    await shareToSquad(u, squad, { all: true });
    a.eq(
      'sharing twice does not duplicate share rows',
      (await dbRows('ctx_shares')).length,
      shares1,
    );
    const own = await items(u);
    a.ok(
      'non-calendar sources are shared with that squad only',
      own
        .filter((s) => !CALENDAR_KINDS.has(s.kind))
        .every(
          (s) => s.visibility === 'squad' && s.sharedWith.length === 1 && s.sharedWith[0] === squad,
        ),
    );
    a.ok(
      'calendar events stay private (never bulk-shared)',
      own
        .filter((s) => CALENDAR_KINDS.has(s.kind))
        .every((s) => s.visibility === 'private' && s.sharedWith.length === 0),
    );
    const visible = await items(ben, squad);
    const want = new Set(nonCal.map((s) => s.id));
    a.ok(
      'the squad member can now read every shared source',
      [...want].every((id) => visible.some((v) => v.id === id)),
      `${visible.length}/${want.size}`,
    );
    a.ok(
      'and nothing else (no calendar event, no unpicked file)',
      visible.every((v) => want.has(v.id)),
    );
    const probeHits = (await searchContext(ben, FACTS.cltQuestion, { squadId: squad })).results;
    a.ok(
      'shared hits are marked shared, owner-private provenance stays fixture',
      probeHits.length > 0 &&
        probeHits.every((h) => h.shared === true && String(h.provenance).endsWith(':fixture')),
    );
    for (const t of PRIVATE_FIXTURE) {
      const r = (await searchContext(ben, t, { squadId: squad })).results;
      a.ok(
        `squad search for a private string finds none of it (${t.slice(0, 14)}...)`,
        !r.some((h) => `${h.title} ${h.text}`.toLowerCase().includes(t.toLowerCase())),
      );
    }
    a.noLeak('squad search results', JSON.stringify(probeHits), PRIVATE);
    if (dan) {
      a.eq(
        'a user in another squad sees nothing',
        (await items(dan, c.world.squadB?.id)).length,
        0,
      );
      a.eq(
        '...and cannot open a shared source',
        (await openSource(dan, { id: aSrc.id })).status,
        404,
      );
    }

    // a calendar event is shared only when listed explicitly, then withdrawn
    const ev = own.find((s) => s.kind === 'gcal_event');
    if (ev) {
      const con = (await listConnections(u)).connections.find((x) => x.provider === 'google')!;
      await shareToSquad(u, squad, { connectionId: con.id, sourceIds: [ev.id] });
      const seen = (await searchContext(ben, HUB_FIXTURE.google.eventNeedle, { squadId: squad }))
        .results;
      a.ok(
        'an explicitly shared calendar event becomes readable',
        seen.some((h) => h.sourceId === ev.id),
      );
      await shareToSquad(u, squad, { connectionId: con.id, sourceIds: [ev.id], shared: false });
      a.ok(
        'and is gone again once withdrawn',
        !(
          await searchContext(ben, HUB_FIXTURE.google.eventNeedle, { squadId: squad })
        ).results.some((h) => h.sourceId === ev.id),
      );
    }

    // opting out removes access at once; then opt back in for S3
    await optIn(u, squad, false);
    a.eq('after opt-out the squad sees nothing', (await items(ben, squad)).length, 0);
    a.ok(
      'after opt-out the sources are private again',
      (await items(u)).every((s) => s.visibility === 'private' && s.sharedWith.length === 0),
    );
    a.eq(
      'a withdrawn source answers 404 to the member',
      (await openSource(ben, { id: aSrc.id })).status,
      404,
    );
    await optIn(u, squad, true);

    // what the browser shows after sharing
    if (c.actors.rhea) {
      const page = c.actors.rhea.page;
      await page.goto('/squad/connections');
      await page
        .locator('article[aria-label="canvas connection"]')
        .waitFor({ timeout: 15_000 })
        .catch(() => undefined);
      const text = await page
        .locator('body')
        .innerText()
        .catch(() => '');
      a.ok('web shows the imported counts', /imported/i.test(text) && /assignments/i.test(text));
      a.ok('web shows the share state', /shared with/i.test(text));
      const hits = ID_PATTERNS_NO_PHONE.filter(([, re]) => re.test(text)).map(([n]) => n);
      a.ok(
        'no raw squad or student ids on the Connections page after sharing',
        hits.length === 0,
        `found: ${hits.join(', ')}`,
      );
      await a.shot(page, 'connections-shared');
    }
  },
};

export const S3: StepDef<GateCtx> = {
  id: 'S3',
  title: 'Agents retrieve permitted context with verified citations',
  needs: [P.context, P_NOOK, P.mentions],
  label:
    'fixture (retrieval and source viewer asserted at the API; chat answers use the demo model unless LIVE=1)',
  fixture: async (c, a) => {
    const rhea = c.world.users.rhea;
    const ben = c.world.users.ben;
    const squad = c.world.squadA.id;
    const chatId = c.world.squadA.chatId;
    const real = c.llm.llm === 'gemini';
    if (await ensureConnected(rhea, squad))
      a.note('S3 connected and shared the accounts itself (earlier steps did not)');
    const file = HUB_FIXTURE.canvas.file;

    // A. retrieval and the source viewer contract (deterministic, no model)
    const res = await searchContext(ben, FACTS.cltQuestion, { squadId: squad });
    a.eq('GET /v1/context/search is 200', res.status, 200);
    const hit = res.results.find((h) => h.title === file.title && h.text.includes(file.quote));
    a.ok(
      'the shared lecture chunk is retrieved for the squad member',
      !!hit,
      res.results.map((h) => h.title).join(' | '),
    );
    if (hit) {
      a.ok(
        'hit is marked shared and fixture',
        hit.shared === true && hit.provenance === 'canvas:fixture',
      );
      a.ok(
        'hit citation quote is a verbatim sentence of the chunk',
        hit.text.includes(hit.citation.quote),
      );
      a.eq('citation names the hit source', hit.citation.source?.id, hit.sourceId);
      const viewed = await openSource(
        ben,
        { id: hit.sourceId, kind: hit.kind, anchor: hit.anchor },
        hit.citation.quote,
        squad,
      );
      const v = viewed.json;
      a.ok(
        'the citation resolves through GET /v1/context/source',
        viewed.status === 200 && v?.ok === true,
        `status ${viewed.status}`,
      );
      a.eq('the quote is verified verbatim by the hub', v?.quoteVerified, true);
      a.ok(
        'the quoted line is highlighted',
        Array.isArray(v?.lines) && v.lines.some((l: any) => l.hit),
      );
      a.eq('viewer says fixture provenance', v?.provenance, 'fixture');
      a.eq('viewer names the provider', v?.provider, 'canvas');
      a.ok(
        'viewer links to the Canvas deep link',
        String(v?.externalUrl).startsWith(CANVAS_FIXTURE_BASE),
        String(v?.externalUrl),
      );
      a.eq('viewer tells the member it is shared by someone else', v?.shared, true);
      const full = await openSource(
        ben,
        { id: hit.sourceId, kind: hit.kind, anchor: hit.anchor },
        file.quote,
        squad,
      );
      a.eq('the lecture sentence itself is verified on its page', full.json?.quoteVerified, true);
      const forged = await openSource(
        ben,
        { id: hit.sourceId, kind: hit.kind, anchor: hit.anchor },
        'The standard error of the mean always equals zero.',
        squad,
      );
      a.ok(
        'a forged quote is NOT verified',
        forged.json?.ok === true && forged.json?.quoteVerified === false,
      );
      a.eq(
        'a wrong kind is a miss, not a leak',
        (await openSource(ben, { id: hit.sourceId, kind: 'gcal_event' }, undefined, squad)).status,
        404,
      );
      a.noLeak('source viewer response', viewed.text, PRIVATE);
    }
    const own = await items(rhea);
    const cal = own.find((s) => s.kind === 'gcal_event');
    if (cal)
      a.eq(
        'a calendar event Rhea did not share is 404 for Ben',
        (await openSource(ben, { id: cal.id }, undefined, squad)).status,
        404,
      );
    const none = await searchContext(ben, FACTS.unsupported, { squadId: squad });
    a.eq('retrieval returns nothing for an unsupported question', none.results.length, 0);
    for (const t of PRIVATE_FIXTURE)
      a.ok(
        `private string not retrievable by the squad (${t.slice(0, 14)}...)`,
        !(await searchContext(ben, t, { squadId: squad })).results.some((h) =>
          `${h.title} ${h.text}`.toLowerCase().includes(t.toLowerCase()),
        ),
      );
    c.state.answerItemIds = citationKeys(res.results.map((h) => h.citation));

    // B. @cubbie in the squad web chat, answered from the asker's own Canvas (Nook "what is due", no model involved)
    const due = await ask(rhea, chatId, `@cubbie ${FACTS.hw4Question}`);
    const dueMsg = due.reply;
    if (a.ok('a bot answer arrived for the due question', !!dueMsg)) {
      const t = dueMsg!.text;
      const order = HUB_FIXTURE.canvas.assignments.map((x) => t.indexOf(x.title));
      a.ok(
        "answer lists the assignments from Rhea's synced Canvas",
        order.every((i) => i >= 0),
        order.join(','),
      );
      a.ok(
        'sorted by due date (Nov 2, Nov 5, Nov 16)',
        order[0]! < order[2]! && order[2]! < order[1]!,
        order.join(','),
      );
      a.ok('answer carries the due date in UTC', t.includes(FACTS.hw4DueDay) && /UTC/.test(t));
      a.noLeak('due answer', t, PRIVATE);
      a.noRawIds('due answer', t);
      a.eq('answer demo flag matches the model mode', !!dueMsg!.demo, !real);
      a.modeBadge('due answer', dueMsg!.demo ? 'Demo' : t, c.llm.llm);
      for (const ct of dueMsg!.citations ?? []) {
        const s = (ct as { source?: { id: string; kind: string; anchor?: string } }).source;
        if (s)
          a.ok(
            `due answer citation ${ct.label} resolves`,
            (await openSource(rhea, s)).json?.ok === true,
          );
      }
    }

    // C. a content question from a squad member, grounded in what Rhea shared
    const g = await ask(ben, chatId, `@cubbie ${FACTS.cltQuestion}`);
    const gm = g.reply;
    if (a.ok('a bot answer arrived for the content question', !!gm)) {
      const cites = (gm!.citations ?? []) as {
        file: string;
        page: number;
        label: string;
        source?: { id: string; kind: string; anchor?: string };
      }[];
      if (real) {
        a.ok(
          'grounded answer carries at least one citation on the chat message',
          cites.length >= 1,
          'ChatMessage.citations is empty',
        );
        a.ok(
          'a citation points into the shared lecture file',
          cites.some((x) => x.source?.kind === 'canvas_file' || x.file === file.title),
        );
        a.ok('the answer states the grounded formula', /square root/i.test(gm!.text));
      } else {
        a.note(
          'demo model: the context-claims prompt is not served by the demo LLM, so a context-grounded chat answer cannot be produced without LIVE=1; retrieval and the viewer are asserted above',
        );
      }
      for (const ct of cites)
        if (ct.source)
          a.ok(
            `citation ${ct.label} resolves through the source viewer`,
            (await openSource(ben, ct.source, undefined, squad)).json?.ok === true,
          );
      a.ok(
        'no citation names a private source',
        !cites.some((x) =>
          PRIVATE_FIXTURE.some((p) =>
            `${x.file} ${x.label}`.toLowerCase().includes(p.toLowerCase()),
          ),
        ),
      );
      a.noLeak('content answer', gm!.text, PRIVATE);
      a.noRawIds('content answer', gm!.text);
      a.eq('answer demo flag matches the model mode', !!gm!.demo, !real);
      a.modeBadge('content answer', gm!.demo ? 'Demo' : gm!.text, c.llm.llm);
    }

    // D. an unsupported question: the real not-in-materials behaviour, never an invented citation
    const un = await ask(ben, chatId, `@cubbie ${FACTS.unsupported}`);
    if (a.ok('a bot answer arrived for the unsupported question', !!un.reply)) {
      a.ok(
        'answer is the not-in-materials refusal',
        un.reply!.text.includes(NOT_IN_MATERIALS),
        un.reply!.text.slice(0, 120),
      );
      a.eq('no citation is invented', (un.reply!.citations ?? []).length, 0);
      a.noLeak('refusal', un.reply!.text, PRIVATE);
    }

    // E. what the web chat shows
    if (c.actors.rhea) {
      const page = c.actors.rhea.page;
      const opened = await openGroupChat(c.actors.rhea, chatId);
      a.ok('web chat opens the squad thread', opened);
      const bubbleOf = (id: string) =>
        page.locator(`[data-testid="chat-message"][data-message-id="${id}"]`);
      if (dueMsg) {
        const b = bubbleOf(dueMsg.id);
        const there = await b.waitFor({ timeout: 15_000 }).then(
          () => true,
          () => false,
        );
        a.ok('the due answer is visible in the web chat', there);
        if (there) {
          const text = await b.innerText();
          a.ok(
            'the web bubble shows the assignment list',
            text.includes(HUB_FIXTURE.canvas.assignments[0]!.title),
          );
          a.noLeak('web chat bubble', text, PRIVATE);
          const label = await b.getByTestId('chat-demo-label').count();
          a.ok(
            real
              ? 'no Demo label while the model is real'
              : 'Demo label visible on the demo-model answer',
            real ? label === 0 : label > 0,
          );
        }
      }
      if (gm) {
        const b = bubbleOf(gm.id);
        const there = await b.waitFor({ timeout: 15_000 }).then(
          () => true,
          () => false,
        );
        a.ok('the content answer is visible in the web chat', there);
        const n = there ? await b.getByTestId('chat-citation-chip').count() : 0;
        a.eq('one citation chip per chat citation', n, (gm.citations ?? []).length);
        if (n > 0) {
          await b.getByTestId('chat-citation-chip').first().click();
          const ex = page.getByTestId('chat-citation-excerpt');
          a.ok(
            'the chip opens the excerpt sheet',
            await ex.waitFor({ timeout: 8000 }).then(
              () => true,
              () => false,
            ),
          );
          const exText = await ex.innerText().catch(() => '');
          a.ok(
            'the excerpt is not an error',
            !!exText.trim() && !/could not find|did not load/i.test(exText),
            exText.slice(0, 120),
          );
          a.noLeak('excerpt sheet', exText, PRIVATE);
          await a.shot(page, 'citation-excerpt');
          await page.keyboard.press('Escape');
        } else
          a.note(
            'the answer has no citation chip; the chat chip opens the library excerpt (ctl.api.citation), not /v1/context/source, for PDFs only',
          );
      }
      const thread = await page
        .locator('[data-testid="chat-message"]')
        .allInnerTexts()
        .catch(() => []);
      a.noLeak('web chat thread', thread.join('\n'), PRIVATE);
      await a.shot(page, 'cubbie-answers');
    }
  },
};
