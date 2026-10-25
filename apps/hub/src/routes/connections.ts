import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { SOURCE_KINDS, type SourceKind } from '@squad/core';
import {
  ALLOWED_SCOPES,
  createRetrieveContext,
  normalizeText,
  quoteOnPage,
  type ContextConnection,
  type ContextSource,
  type ContextViewer,
} from '@squad/brain';
import { requireUser } from '../auth';
import { TokenKeyError } from '../context/tokens';
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

const Share = z.strictObject({
  squadId: z.string().min(1).max(64),
  /** Explicit source ids to share (or stop sharing). */
  sourceIds: z.array(z.string().max(80)).max(500).optional(),
  /** Share every non-calendar source of the connection. Calendar events must be listed explicitly. */
  all: z.boolean().optional(),
  shared: z.boolean().default(true),
});

const CALENDAR_KINDS: ReadonlySet<SourceKind> = new Set(['gcal_event', 'canvas_event']);

const STATUS_LABEL: Record<ContextConnection['status'], string> = {
  live: 'Connected',
  expired: 'Expired: reconnect to resume syncing',
  revoked: 'Disconnected: imported data deleted',
  error: 'Error',
};
const providerName = (p: ContextConnection['provider']) => (p === 'canvas' ? 'Canvas' : 'Google');

/** What the browser may see about a connection. No token, feed URL, account id or hash is ever included. */
function view(svc: ContextService, c: ContextConnection) {
  const sources = svc.store.sourcesOfConnection(c.id);
  const byKind: Record<string, number> = {};
  for (const s of sources) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const squads = [...new Set(sources.flatMap((s) => s.sharedWith))].sort();
  const fixture = c.mode === 'fixture';
  return {
    id: c.id,
    provider: c.provider,
    variant: c.variant,
    mode: c.mode,
    modeLabel: fixture
      ? `Demo data from repo fixtures. No real ${providerName(c.provider)} account is connected.`
      : `Live ${providerName(c.provider)} connection`,
    status: c.status,
    statusLabel: c.degraded
      ? 'Degraded: the provider rejected the credential; showing the last imported data'
      : STATUS_LABEL[c.status],
    degraded: c.degraded,
    note: c.statusNote,
    scopes: c.scopes,
    createdAt: c.createdAt,
    lastSyncAt: c.lastSyncAt,
    expiresAt: c.expiresAt,
    canSync: c.status === 'live' || c.status === 'error',
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
  const err = (c: Context, status: 400 | 404 | 409 | 501 | 503, code: string, message?: string) =>
    c.json({ error: { code, ...(message ? { message } : {}) } }, status);

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
    if (p.data.mode === 'live')
      return err(
        c,
        501,
        'live_not_available',
        'Real Canvas/Google connections are not available yet (no OAuth client or institution grant). Use fixture mode.',
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
            : 400,
        res.code,
        res.message,
      );
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

  return r;
}
