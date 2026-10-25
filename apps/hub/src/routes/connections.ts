import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { SOURCE_KINDS, type SourceKind } from '@squad/core';
import {
  ALLOWED_SCOPES,
  CANVAS_FILE_TYPES,
  GOOGLE_CONSENT_SCOPES,
  canvasFileMatchesType,
  connectionState,
  createRetrieveContext,
  normalizeText,
  quoteOnPage,
  type ContextConnection,
  type ContextSource,
  type ContextViewer,
} from '@squad/brain';
import { requireUser } from '../auth';
import { TokenKeyError } from '../context/tokens';
import { mergeContextBusy, purgeContextBusy } from '../context/busy';
import { contextServiceFor, type ContextService } from '../context/service';
import type { HubApp, HubDeps, HubEnv } from '../types';

const Connect = z.strictObject({
  provider: z.enum(['canvas', 'google']),
  variant: z.enum(['feed', 'token']).optional(),
  scopes: z.array(z.string().max(120)).min(1).max(6),
  feedUrl: z.string().max(2000).optional(),
  token: z.string().max(2000).optional(),
  baseUrl: z.string().max(300).optional(),
  pickedFileIds: z.array(z.string().max(200)).max(50).optional(),
  /** `live` is accepted only to be refused honestly: no real OAuth client or institution grant exists yet. */
  mode: z.enum(['fixture', 'live']).optional(),
});

const CanvasPayload = z.strictObject({
  origin: z.string().max(300),
  canvas_user_id: z.string().max(40),
  courses: z
    .array(
      z.strictObject({
        id: z.string().max(40),
        name: z.string().max(300),
        course_code: z.string().max(80).nullable(),
      }),
    )
    .max(200),
  assignments: z
    .array(
      z.strictObject({
        id: z.string().max(40),
        course_id: z.string().max(40),
        name: z.string().max(400),
        due_at: z.string().max(40).nullable(),
        html_url: z.string().max(600).nullable(),
        description: z.string().max(20_000).nullable().optional(),
        updated_at: z.string().max(40).nullable().optional(),
      }),
    )
    .max(5000),
  files: z
    .array(
      z.strictObject({
        id: z.string().max(40),
        course_id: z.string().max(40),
        display_name: z.string().max(400),
        'content-type': z.string().max(120).nullable(),
        size: z.number().nullable(),
        url: z.string().max(1200).nullable(),
        updated_at: z.string().max(40).nullable(),
        folder: z.string().max(300).nullable().optional(),
      }),
    )
    .max(5000),
  modules: z
    .array(
      z.strictObject({
        id: z.string().max(40),
        course_id: z.string().max(40),
        module: z.string().max(300),
        title: z.string().max(400),
        type: z.string().max(60).nullable(),
        html_url: z.string().max(600).nullable(),
      }),
    )
    .max(5000)
    .optional(),
});
const CanvasRegister = z.strictObject({
  canvas_user_id: z.string().max(40),
  canvas_origin: z.string().max(300),
  name: z.string().max(200).nullable().optional(),
  primary_email: z.string().max(200).nullable().optional(),
});
const CanvasReport = z.strictObject({
  outcome: z.enum(['expired', 'rate_limited', 'error']),
  retry_after_ms: z.number().int().min(0).max(86_400_000).optional(),
});
const PairExchange = z.strictObject({ code: z.string().min(4).max(20) });

const Share = z.strictObject({
  squadId: z.string().min(1).max(64),
  /** Explicit source ids to share (or stop sharing). */
  sourceIds: z.array(z.string().max(80)).max(500).optional(),
  /** Share every non-calendar source of the connection. Calendar events must be listed explicitly. */
  all: z.boolean().optional(),
  shared: z.boolean().default(true),
});

const CALENDAR_KINDS: ReadonlySet<SourceKind> = new Set(['gcal_event', 'canvas_event']);

const STATE_LABEL = {
  live: 'Connected',
  fixture: 'Demo data, not a real account',
  expired: 'Expired: reconnect to resume syncing',
  revoked: 'Disconnected: imported data deleted',
  rate_limited: 'Rate limited by the provider: retrying automatically, imported data is kept',
  error: 'Error: the last sync failed, showing the last imported data',
} as const;
const providerName = (p: ContextConnection['provider']) => (p === 'canvas' ? 'Canvas' : 'Google');

/** What the browser may see about a connection. No token, feed URL, account id or hash is ever included. */
function view(svc: ContextService, c: ContextConnection) {
  const sources = svc.store.sourcesOfConnection(c.id);
  const byKind: Record<string, number> = {};
  for (const s of sources) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const squads = [...new Set(sources.flatMap((s) => s.sharedWith))].sort();
  const fixture = c.mode === 'fixture';
  const sync = svc.store.syncState(c.id);
  const state = connectionState(c);
  const viaExtension = c.variant === 'session';
  return {
    id: c.id,
    provider: c.provider,
    variant: c.variant,
    mode: c.mode,
    modeLabel: fixture
      ? `Demo data from repo fixtures. No real ${providerName(c.provider)} account is connected.`
      : viaExtension
        ? 'Synced from your own browser session by the Squad extension'
        : `Live ${providerName(c.provider)} connection`,
    /** One of live | fixture | expired | revoked | rate_limited | error. */
    state,
    stateLabel:
      c.degraded && state === 'error'
        ? 'Degraded: the provider rejected the credential; showing the last imported data'
        : STATE_LABEL[state],
    status: c.status,
    statusLabel: c.degraded
      ? 'Degraded: the provider rejected the credential; showing the last imported data'
      : STATE_LABEL[state],
    degraded: c.degraded,
    note: c.statusNote,
    scopes: c.scopes,
    createdAt: c.createdAt,
    lastSyncAt: c.lastSyncAt,
    expiresAt: c.expiresAt,
    retryAfter: sync.retryAfter,
    syncPhase: sync.startedAt !== null ? 'syncing' : 'idle',
    lastOutcome: sync.lastOutcome,
    cursor: sync.cursor
      ? {
          updatedAt: sync.cursor.updatedAt,
          windowFrom: sync.cursor.windowFrom,
          windowTo: sync.cursor.windowTo,
        }
      : null,
    /** Where a sync is started: `extension` connections are synced from the browser, the rest from the hub. */
    syncVia: viaExtension ? 'extension' : 'hub',
    canSync:
      !viaExtension && (c.status === 'live' || c.status === 'error' || c.status === 'rate_limited'),
    sources: { total: sources.length, byKind },
    sharedWithSquads: squads,
  };
}

function sourceView(s: ContextSource) {
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    courseId: s.courseId,
    url: s.url,
    dueAt: s.dueAt,
    startsAt: s.startsAt,
    modifiedAt: s.modifiedAt,
    fetchedAt: s.fetchedAt,
    visibility: s.visibility,
    sharedWith: s.sharedWith,
    provenance: s.provenance,
  };
}

export function createConnectionRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireUser(deps);
  const err = (
    c: Context,
    status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 501 | 502 | 503,
    code: string,
    message?: string,
  ) => c.json({ error: { code, ...(message ? { message } : {}) } }, status);

  /** The viewer's readable scope: their own sources plus sources shared into squads they are verified members of. */
  const viewerOf = (c: Context<HubEnv>): ContextViewer => {
    const id = c.get('user').id;
    const all = deps.directory.squadsOf(id).filter((q) => deps.squads.isMember(q, id));
    const want = c.req.header('x-squad-id');
    return { studentId: id, squadIds: want && all.includes(want) ? [want] : all };
  };

  r.post('/v1/connections', need, async (c) => {
    const p = Connect.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return err(c, 400, 'invalid_request');
    // Live is possible without a registered OAuth client only for a student-supplied Canvas token. Google live
    // goes through /v1/connections/google/authorize; everything else is refused honestly.
    if (p.data.mode === 'live' && !(p.data.provider === 'canvas' && p.data.variant === 'token'))
      return err(
        c,
        501,
        'live_not_available',
        'Use the Canvas browser extension or a Canvas token for a live Canvas connection, and the Google sign-in for Google. Fixture mode is the demo.',
      );
    const svc = contextServiceFor(deps);
    let res;
    try {
      res = await svc.connect(c.get('user').id, p.data);
    } catch (e) {
      if (e instanceof TokenKeyError) return err(c, 503, 'token_store_unconfigured');
      deps.log.error('context.connect_failed', { err: (e as Error).name });
      return err(c, 503, 'connect_failed');
    }
    if (!res.ok)
      return err(
        c,
        res.code === 'already_connected'
          ? 409
          : res.code === 'token_store_unconfigured'
            ? 503
            : res.code === 'credential_rejected'
              ? 401
              : res.code === 'rate_limited'
                ? 429
                : res.code === 'provider_unreachable'
                  ? 502
                  : 400,
        res.code,
        res.message,
      );
    mergeContextBusy(deps, c.get('user').id);
    deps.log.info('context.connected', {
      connectionId: res.connection.id,
      provider: res.connection.provider,
      scopes: res.connection.scopes,
    });
    return c.json({ connection: view(svc, res.connection), sync: res.sync }, 201);
  });

  r.get('/v1/connections', need, async (c) => {
    const svc = contextServiceFor(deps);
    const mine = svc.store.connectionsOf(c.get('user').id);
    for (const x of mine) await svc.tick(x.id);
    return c.json({
      mode: svc.mode,
      allowedScopes: ALLOWED_SCOPES,
      connections: svc.store.connectionsOf(c.get('user').id).map((x) => view(svc, x)),
    });
  });

  r.get('/v1/connections/:id/sources', need, (c) => {
    const svc = contextServiceFor(deps);
    const conn = svc.store.connection(c.req.param('id'));
    if (!conn || conn.ownerId !== c.get('user').id) return err(c, 404, 'not_found');
    return c.json({ sources: svc.store.sourcesOfConnection(conn.id).map(sourceView) });
  });

  r.post('/v1/connections/:id/sync', need, async (c) => {
    const svc = contextServiceFor(deps);
    const conn = svc.store.connection(c.req.param('id'));
    if (!conn || conn.ownerId !== c.get('user').id) return err(c, 404, 'not_found');
    if (conn.status === 'revoked') return err(c, 409, 'connection_revoked');
    if (conn.status === 'expired')
      return err(c, 409, 'connection_expired', 'Credential expired. Reconnect to resume syncing.');
    const sync = await svc.sync(c.get('user').id, conn.id);
    mergeContextBusy(deps, c.get('user').id);
    return c.json({ connection: view(svc, svc.store.connection(conn.id)!), sync });
  });

  r.post('/v1/connections/:id/share', need, async (c) => {
    const p = Share.safeParse(await c.req.json().catch(() => null));
    if (!p.success || (!p.data.all && !p.data.sourceIds?.length))
      return err(c, 400, 'invalid_request');
    const uid = c.get('user').id;
    const svc = contextServiceFor(deps);
    const conn = svc.store.connection(c.req.param('id'));
    if (!conn || conn.ownerId !== uid) return err(c, 404, 'not_found');
    if (!deps.squads.isMember(p.data.squadId, uid)) return err(c, 404, 'not_found');
    const own = svc.store.sourcesOfConnection(conn.id);
    const picked = new Set(p.data.sourceIds ?? []);
    const targets = own.filter(
      (s) => picked.has(s.id) || (p.data.all === true && !CALENDAR_KINDS.has(s.kind)),
    );
    for (const s of targets) {
      if (p.data.shared) svc.store.share(s.id, p.data.squadId);
      else svc.store.unshare(s.id, p.data.squadId);
    }
    deps.log.info('context.share', {
      connectionId: conn.id,
      squadId: p.data.squadId,
      shared: p.data.shared,
      count: targets.length,
    });
    return c.json({ shared: p.data.shared, squadId: p.data.squadId, count: targets.length });
  });

  r.delete('/v1/connections/:id', need, async (c) => {
    const svc = contextServiceFor(deps);
    const conn = svc.store.connection(c.req.param('id'));
    if (!conn || conn.ownerId !== c.get('user').id) return err(c, 404, 'not_found');
    // A second DELETE on an already revoked connection removes the (empty) row from the list.
    if (conn.status === 'revoked' && c.req.query('remove') === '1') {
      svc.store.deleteConnection(conn.id);
      return c.json({ removed: true });
    }
    purgeContextBusy(deps, c.get('user').id, conn.id);
    const out = await svc.disconnect(c.get('user').id, conn.id);
    return c.json({ status: 'revoked', purged: out?.purged ?? { sources: 0, chunks: 0 } });
  });

  r.get('/v1/context/search', need, async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (!q || q.length > 400) return err(c, 400, 'invalid_request');
    const limit = Math.min(10, Math.max(1, Number(c.req.query('limit')) || 5));
    const svc = contextServiceFor(deps);
    const kind = c.req.query('kind');
    if (kind && !(SOURCE_KINDS as readonly string[]).includes(kind))
      return err(c, 400, 'invalid_request');
    const viewer = viewerOf(c);
    const retrieve = createRetrieveContext(svc.store, viewer, { limit });
    const hits = await retrieve(q, c.req.query('courseId') || undefined);
    return c.json({
      mode: svc.mode,
      results: hits
        .filter((h) => !kind || h.kind === kind)
        .map((h) => ({ ...h, provenance: svc.store.source(h.sourceId)?.provenance ?? null })),
    });
  });

  /** Source viewer contract for non-PDF sources (see packages/web/.../source-viewer/types.ts `ExternalSourceExcerpt`). */
  r.get('/v1/context/source', need, (c) => {
    const id = c.req.query('id') ?? '';
    const kind = c.req.query('kind');
    const anchor = c.req.query('anchor') || undefined;
    const quote = (c.req.query('quote') ?? '').trim().slice(0, 600) || null;
    if (!id || id.length > 200) return err(c, 400, 'invalid_request');
    const svc = contextServiceFor(deps);
    const viewer = viewerOf(c);
    const src = svc.store.readable(id, viewer);
    if (!src || (kind && src.kind !== kind)) {
      // Only the owner learns that a source existed; everyone else sees the same answer as for a missing one.
      const t = svc.store.tombstone(id);
      if (!src && t && t.ownerId === viewer.studentId)
        return c.json({ ok: false, reason: t.reason });
      return c.json({ ok: false, reason: 'not_found' }, 404);
    }
    const chunk = svc.store.chunk(src.id, anchor);
    if (!chunk) return c.json({ ok: false, reason: 'page_missing' });
    const verified = quote ? quoteOnPage(quote, chunk.text) : false;
    const rows = chunk.text.split('\n').filter((l) => l.trim());
    const nq = quote ? normalizeText(quote) : '';
    let hit = rows.map((l) => nq.length > 0 && ` ${normalizeText(l)} `.includes(` ${nq} `));
    if (verified && !hit.some(Boolean)) hit = rows.map(() => true); // quote wraps across lines: mark the whole chunk
    return c.json({
      ok: true,
      sourceKind: src.kind,
      sourceId: src.id,
      title: src.title,
      courseId: src.courseId,
      anchor: chunk.anchor,
      section: chunk.section,
      lines: rows.map((text, i) => ({ n: i + 1, text, hit: hit[i] === true })),
      quote,
      quoteVerified: verified,
      externalUrl: src.url,
      provider: src.provenance.split(':')[0],
      provenance: src.provenance.endsWith(':fixture') ? 'fixture' : 'live',
      fetchedAt: src.fetchedAt,
      shared: src.ownerId !== viewer.studentId,
    });
  });

  /* ---- Nook parity: browser-extension route (Canvas), Google OAuth, Nook-shaped reads ---------------------------- */

  /** Signed-in web session OR a scoped extension bearer (`sqx_...`). Sets `user` either way. */
  const extOrUser: MiddlewareHandler<HubEnv> = async (c, next) => {
    const h = c.req.header('authorization');
    if (h?.startsWith('Bearer sqx_')) {
      const uid = contextServiceFor(deps).ext.verify(h.slice(7));
      if (!uid) return c.json({ error: { code: 'unauthorized' } }, 401);
      c.set('user', { id: uid });
      return next();
    }
    return need(c, next);
  };

  // Pairing: the signed-in web app mints a one-time code; the extension exchanges it for its own bearer.
  r.post('/v1/connections/extension/pair', need, (c) =>
    c.json(contextServiceFor(deps).ext.pair(c.get('user').id)),
  );
  r.post('/v1/connections/extension/token', async (c) => {
    const p = PairExchange.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return err(c, 400, 'invalid_request');
    const out = contextServiceFor(deps).ext.exchange(p.data.code);
    if (!out) return err(c, 401, 'pairing_invalid', 'This pairing code is wrong, used or expired.');
    return c.json(out);
  });
  r.delete('/v1/connections/extension/sessions', need, (c) =>
    c.json({ revoked: contextServiceFor(deps).ext.revokeAll(c.get('user').id) }),
  );

  // Nook `canvas-authorize` registration. Errors keep Nook's codes; the owner of a bound login is never disclosed.
  r.post('/v1/connections/canvas/register', extOrUser, async (c) => {
    const p = CanvasRegister.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return err(c, 422, 'invalid_request');
    const svc = contextServiceFor(deps);
    const res = svc.registerCanvasSession(c.get('user').id, {
      canvasUserId: p.data.canvas_user_id,
      origin: p.data.canvas_origin,
    });
    if (!res.ok)
      return err(
        c,
        res.code === 'canvas_origin_not_allowed' || res.code === 'invalid_request'
          ? 400
          : res.code === 'token_store_unconfigured'
            ? 503
            : 409,
        res.code,
      );
    return c.json(
      { connection: view(svc, res.connection), created: res.created },
      res.created ? 201 : 200,
    );
  });

  // Nook `canvas-accounts/:id/sync`: 404 not yours, 422 invalid, 409 canvas_session_mismatch.
  r.post('/v1/connections/:id/canvas-sync', extOrUser, async (c) => {
    const svc = contextServiceFor(deps);
    const p = CanvasPayload.safeParse(await c.req.json().catch(() => null));
    const conn = svc.store.connection(c.req.param('id'));
    if (!conn || conn.ownerId !== c.get('user').id || conn.variant !== 'session')
      return err(c, 404, 'not_found');
    if (!p.success) return err(c, 422, 'invalid_request');
    const out = await svc.syncCanvasPayload(c.get('user').id, conn.id, p.data);
    mergeContextBusy(deps, c.get('user').id);
    if ('error' in out) {
      if (out.error === 'canvas_session_mismatch')
        return err(c, 409, 'canvas_session_mismatch', 'Payload does not match this Canvas account');
      return out.error === 'connection_revoked'
        ? err(c, 409, 'connection_revoked')
        : err(c, 404, 'not_found');
    }
    return c.json({ ok: true, report: out, connection: view(svc, svc.store.connection(conn.id)!) });
  });

  // The extension reports honest failures it saw in Canvas (session ended, rate limit) so the state is shown everywhere.
  r.post('/v1/connections/:id/canvas-report', extOrUser, async (c) => {
    const p = CanvasReport.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return err(c, 422, 'invalid_request');
    const svc = contextServiceFor(deps);
    if (
      !svc.reportCanvasOutcome(
        c.get('user').id,
        c.req.param('id'),
        p.data.outcome,
        p.data.retry_after_ms,
      )
    )
      return err(c, 404, 'not_found');
    return c.json({ connection: view(svc, svc.store.connection(c.req.param('id'))!) });
  });

  // Nook-shaped reads of what is synced (own sources only; squad-shared ones are for search and citations).
  const canvasRows = (uid: string, kind: SourceKind) => {
    const svc = contextServiceFor(deps);
    return svc.store
      .connectionsOf(uid)
      .filter((x) => x.provider === 'canvas' && x.status !== 'revoked')
      .flatMap((x) => svc.store.sourcesOfConnection(x.id))
      .filter((s) => s.kind === kind);
  };
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  r.get('/v1/context/canvas/assignments', need, (c) => {
    const course = c.req.query('course_id');
    const data = canvasRows(c.get('user').id, 'canvas_assignment')
      .filter((s) => !course || s.courseId === course)
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
      .map((s) => ({
        id: s.externalId.replace(/^assignment:/, ''),
        source: s.uri,
        course_id: s.courseId,
        name: s.title,
        due_at: iso(s.dueAt),
        html_url: s.url,
      }));
    c.header('Cache-Control', 'no-store');
    return c.json({ data });
  });
  r.get('/v1/context/canvas/files', need, (c) => {
    const type = c.req.query('type');
    if (type && !(CANVAS_FILE_TYPES as readonly string[]).includes(type))
      return err(c, 422, 'invalid_request', 'type must be ppt or pdf');
    const svc = contextServiceFor(deps);
    const course = c.req.query('course_id');
    const data = canvasRows(c.get('user').id, 'canvas_file')
      .filter((s) => !course || s.courseId === course)
      .map((s) => {
        const ct = /\((\S+\/\S+)\)/.exec(svc.store.chunks(s.id)[0]?.text ?? '')?.[1] ?? null;
        return {
          id: s.externalId.replace(/^file:/, ''),
          source: s.uri,
          course_id: s.courseId,
          display_name: s.title,
          'content-type': ct,
          url: s.url,
          updated_at: iso(s.modifiedAt),
        };
      })
      .filter((f) => !type || canvasFileMatchesType(f, type as 'ppt' | 'pdf'));
    c.header('Cache-Control', 'no-store');
    return c.json({ data });
  });

  // Nook `GET .../integrations/:provider/connect`: returns `{ authorization_url }` (+ our honest `mode`).
  r.get('/v1/connections/google/authorize', need, (c) => {
    const svc = contextServiceFor(deps);
    const picked = (c.req.query('picked') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 50);
    const out = svc.startGoogleAuth(c.get('user').id, {
      returnTo: c.req.query('return_to') ?? '/squad/connections',
      pickedFileIds: picked,
      ...(c.req.query('login_hint') ? { loginHint: c.req.query('login_hint') as string } : {}),
    });
    if ('error' in out)
      return err(c, 400, 'invalid_return_to', 'return_to must be a relative path');
    return c.json({
      authorization_url: out.authorizationUrl,
      mode: out.mode,
      scopes: out.mode === 'live' ? GOOGLE_CONSENT_SCOPES : ALLOWED_SCOPES.google,
    });
  });

  // The labelled consent simulator (only when no Google OAuth client is configured). No account is ever read.
  r.get('/v1/connections/google/sim-consent', (c) => {
    const svc = contextServiceFor(deps);
    if (svc.googleOAuth) return c.text('Not found', 404);
    const state = c.req.query('state') ?? '';
    if (!/^gst_[A-Za-z0-9_-]{10,40}$/.test(state)) return c.text('Not found', 404);
    const cb = (q: string) => `/oauth/google/callback?state=${encodeURIComponent(state)}&${q}`;
    const scopes = ALLOWED_SCOPES.google.map((x) => `<li>${x.split('/').pop()}</li>`).join('');
    c.header('Cache-Control', 'no-store');
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Google consent (demo)</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>Demo consent screen</h1><p><strong>Demo data, not a real Google account.</strong> No Google OAuth client is configured on this server, so nothing real is requested or read. In a real deployment Google shows its own consent screen for these read-only permissions:</p><ul>${scopes}</ul><p><a href="${cb('code=sim')}">Allow (demo)</a> &middot; <a href="${cb('error=access_denied')}">Cancel</a></p></body>`,
    );
  });

  // Nook `/oauth/google/callback`: state check, code exchange, upsert, redirect with ?provider=&status=.
  r.get('/oauth/google/callback', async (c) => {
    const svc = contextServiceFor(deps);
    const out = await svc.completeGoogleAuth({
      state: c.req.query('state') ?? '',
      code: c.req.query('code'),
      error: c.req.query('error'),
    });
    if ('error' in out)
      return err(c, 400, 'oauth_state_invalid', 'OAuth state is invalid or expired');
    mergeContextBusy(deps, out.userId);
    return c.redirect(out.redirect);
  });

  return r;
}
