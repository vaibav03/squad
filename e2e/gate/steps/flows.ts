// Reusable journey fragments (used by the steps and by the variants). All are API-level and side-effect aware.
// Aligned to the REAL hub contract (lib/contract.ts). The hub's real connectors run against the HTTP fakes through the
// fetch seam in gate-hub.ts; upstream misbehaviour goes through the fakes' controls (fakes/client.ts).
import { GOOGLE, SENTINELS } from '../lib/config';
import { api, history, isBot, waitBot, type HMsg } from '../lib/hub';
import { canvas, google, im, type World, type WorldUser } from '../lib/fakes/client';
import { DRIVE_FILES } from '../lib/fakes/content';
import { CANVAS_TOKEN } from '../lib/fakes/fake-canvas';
import { CANVAS_FIXTURE_BASE, CANVAS_SCOPE, ROUTES } from '../lib/contract';

export const asSet = (x: string[]) => [...new Set(x)].sort();

// ------------------------------------------------------------------------------------------------------- shapes
export interface ConnView {
  id: string;
  provider: 'canvas' | 'google';
  variant: string;
  mode: 'fixture' | 'live';
  modeLabel: string;
  state: 'live' | 'fixture' | 'expired' | 'revoked' | 'rate_limited' | 'error';
  stateLabel: string;
  status: string;
  statusLabel: string;
  degraded: boolean;
  note: string | null;
  scopes: string[];
  createdAt: number;
  lastSyncAt: number | null;
  syncPhase: 'idle' | 'syncing';
  lastOutcome: string | null;
  syncVia: 'hub' | 'extension';
  canSync: boolean;
  sources: { total: number; byKind: Record<string, number> };
  sharedWithSquads: string[];
  needsReconnect?: boolean;
  stale?: boolean;
  [k: string]: unknown;
}
export interface SourceRow {
  id: string;
  kind: string;
  title: string;
  courseId: string | null;
  url: string | null;
  dueAt: number | null;
  startsAt: number | null;
  visibility: 'private' | 'squad';
  sharedWith: string[];
  provenance: string;
  connectionId?: string;
  provider?: string;
  [k: string]: unknown;
}
export interface Hit {
  chunkId: string;
  sourceId: string;
  kind: string;
  title: string;
  anchor: string;
  text: string;
  shared: boolean;
  url: string | null;
  provenance: string | null;
  citation: {
    file: string;
    quote: string;
    source?: { kind: string; id: string; anchor?: string; title?: string; url?: string };
  };
  [k: string]: unknown;
}
export interface SyncResult {
  id: string;
  provider: string;
  status: number;
  json: any;
}

// ---------------------------------------------------------------------------------------------------- connections
export async function listConnections(u: WorldUser) {
  const r = await api(u.token, ROUTES.connections);
  return {
    ...r,
    mode: r.json?.mode as 'fixture' | 'live' | undefined,
    allowedScopes: (r.json?.allowedScopes ?? {}) as { google?: string[]; canvas?: string[] },
    connections: (r.status === 200 ? (r.json?.connections ?? []) : []) as ConnView[],
  };
}

/** The user's newest connection for a provider (non-revoked preferred). Listing runs the hub's credential tick. */
export async function connectionStatus(
  u: WorldUser,
  provider: 'canvas' | 'google',
): Promise<ConnView | undefined> {
  const list = (await listConnections(u)).connections.filter((c) => c.provider === provider);
  const live = list.filter((c) => c.status !== 'revoked');
  return [...(live.length ? live : list)].sort((a, b) => b.createdAt - a.createdAt)[0];
}

/**
 * Canvas through the student-token variant in LIVE mode: the hub's real Canvas REST connector runs against the fake
 * Canvas (the gate hub maps https://canvas.fixture.invalid to it). `feed` is the in-process fixture connector (mode
 * fixture), kept for the honest-label check.
 */
export async function connectCanvasToken(u: WorldUser) {
  return api(u.token, ROUTES.connections, {
    method: 'POST',
    json: {
      provider: 'canvas',
      variant: 'token',
      mode: 'live',
      scopes: [CANVAS_SCOPE.token],
      token: CANVAS_TOKEN,
      baseUrl: CANVAS_FIXTURE_BASE,
    },
  });
}
export async function connectCanvas(u: WorldUser, variant: 'token' | 'feed' = 'token') {
  if (variant === 'token') return connectCanvasToken(u);
  return api(u.token, ROUTES.connections, {
    method: 'POST',
    json: {
      provider: 'canvas',
      variant: 'feed',
      scopes: [CANVAS_SCOPE.feed],
      feedUrl: `${CANVAS_FIXTURE_BASE}/feeds/${SENTINELS.feedSecret}_feed/calendar.ics`,
    },
  });
}

const unesc = (s: string) => s.replace(/&amp;/g, '&');

/**
 * The whole Nook-shaped Google consent dance against the fake Google, with the hub's REAL OAuth code: authorize returns
 * the accounts.google.com URL, the gate rewrites its origin to the fake, follows the fake consent page's #allow link
 * (redirect_uri + code + state) against the hub callback, and may replay it. `picked` are the Drive Picker selections.
 * `shortLived` makes the fake issue a 30 s access token so the hub's refresh path (within 60 s of expiry) is reachable.
 */
export async function connectGoogle(
  u: WorldUser,
  opts: {
    picked?: string[];
    replayCallback?: boolean;
    deny?: boolean;
    returnTo?: string;
    shortLived?: boolean;
  } = {},
) {
  const picked = opts.picked ?? [DRIVE_FILES.picked.id];
  const q = new URLSearchParams({ return_to: opts.returnTo ?? '/squad/connections' });
  if (picked.length) q.set('picked', picked.join(','));
  const auth = await api(u.token, `${ROUTES.googleAuthorize}?${q.toString()}`);
  const url: string | undefined = auth.json?.authorization_url;
  if (auth.status !== 200 || !url)
    return { ok: false as const, why: `authorize answered ${auth.status}`, auth };
  const authUrl = new URL(url);
  if (authUrl.host !== 'accounts.google.com')
    return {
      ok: false as const,
      why: `authorization_url host is ${authUrl.host}, not accounts.google.com (hub not in live mode)`,
      auth,
    };
  const params = authUrl.searchParams;
  const consentRes = await fetch(
    `${GOOGLE}/__h/accounts.google.com${authUrl.pathname}${authUrl.search}`,
  );
  const consentHtml = await consentRes.text();
  const allow = /id="allow" href="([^"]+)"/.exec(consentHtml)?.[1];
  const deny = /id="deny" href="([^"]+)"/.exec(consentHtml)?.[1];
  const target = opts.deny ? deny : allow;
  if (!target) return { ok: false as const, why: 'fake consent page has no allow/deny link', auth };
  const cb = new URL(unesc(target));
  const cbPath = cb.pathname + cb.search;
  if (opts.shortLived) await google.ttl(30);
  const first = await api(null, cbPath);
  if (opts.shortLived) await google.ttl(3600);
  const replay = opts.replayCallback ? await api(null, cbPath) : undefined;
  return {
    ok: true as const,
    auth,
    mode: auth.json?.mode as string,
    /** the `scope` parameter of the real authorize URL (identity scopes included) */
    scopeParam: (params.get('scope') ?? '').split(' ').filter(Boolean),
    /** what the hub says it requests */
    requested: (auth.json?.scopes ?? []) as string[],
    authParams: Object.fromEntries(params.entries()) as Record<string, string>,
    consentHtml,
    consentScopes: [...consentHtml.matchAll(/data-scope="([^"]+)"/g)].map((m) => m[1]!),
    callbackStatus: first.status,
    callbackUrl: cb.toString(),
    location: first.headers.get('location') ?? '',
    replayStatus: replay?.status,
    replayText: replay?.text ?? '',
    state: params.get('state') ?? '',
  };
}

/** connectGoogle plus what ended up granted (the hub's connection view), for variants. */
export async function connectGoogleFull(
  u: WorldUser,
  opts: { picked?: string[]; replayCallback?: boolean; shortLived?: boolean } = {},
) {
  const r = await connectGoogle(u, opts);
  if (!r.ok)
    return {
      ok: false as const,
      why: r.why,
      requested: [] as string[],
      granted: [] as string[],
      callbackStatus: 0,
      replayStatus: undefined as number | undefined,
    };
  const view = await connectionStatus(u, 'google');
  return {
    ok: true as const,
    why: '',
    requested: r.scopeParam,
    granted: view?.scopes ?? [],
    callbackStatus: r.callbackStatus,
    replayStatus: r.replayStatus,
    connectionId: view?.id,
  };
}

// --------------------------------------------------------------------------------------------------------- sync
export async function syncConnection(u: WorldUser, id: string): Promise<SyncResult> {
  const r = await api(u.token, ROUTES.connectionSync(id), { method: 'POST', json: {} });
  return {
    id,
    provider: String(r.json?.connection?.provider ?? ''),
    status: r.status,
    json: r.json,
  };
}

/** Sync every connection the hub syncs itself (Canvas session connections sync from the extension). */
export async function syncAll(u: WorldUser) {
  const conns = (await listConnections(u)).connections.filter((c) => c.canSync);
  const results: SyncResult[] = [];
  for (const c of conns) results.push(await syncConnection(u, c.id));
  return {
    ok: results.length > 0 && results.every((r) => r.status === 200),
    status: results.find((r) => r.status !== 200)?.status ?? 200,
    results,
  };
}

/** Canvas + Google connected, Drive file picked, first sync done. */
export async function connectEverything(u: WorldUser, opts: { picked?: string[] } = {}) {
  const c = await connectCanvas(u);
  const g = await connectGoogle(u, opts);
  const s = await syncAll(u);
  return { c, g, s };
}

// ------------------------------------------------------------------------------------------------------- sources
export async function connectionSources(u: WorldUser, id: string): Promise<SourceRow[]> {
  const r = await api(u.token, ROUTES.connectionSources(id));
  return r.status === 200 ? (r.json?.sources ?? []) : [];
}

/**
 * Own sources across the user's connections (no squadId), or, with a squadId, the sources the user can READ through that
 * squad (search over the fixture vocabulary: there is no list-all endpoint for squad-visible sources by design).
 */
export async function items(u: WorldUser, squadId?: string): Promise<SourceRow[]> {
  if (!squadId) {
    const out: SourceRow[] = [];
    for (const c of (await listConnections(u)).connections)
      for (const s of await connectionSources(u, c.id))
        out.push({ ...s, connectionId: c.id, provider: c.provider });
    return out;
  }
  const seen = new Map<string, SourceRow>();
  for (const q of SQUAD_PROBES)
    for (const h of (await searchContext(u, q, { squadId, limit: 10 })).results)
      seen.set(h.sourceId, {
        id: h.sourceId,
        kind: h.kind,
        title: h.title,
        courseId: null,
        url: h.url,
        dueAt: null,
        startsAt: null,
        visibility: 'squad',
        sharedWith: [squadId],
        provenance: h.provenance ?? '',
      });
  return [...seen.values()];
}
/** Queries that together reach every fixture source (used to enumerate what a squad member can read). */
export const SQUAD_PROBES = [
  'homework sampling distributions standard error',
  'lab confidence intervals dorm sleep survey',
  'midterm exam chapters central limit theorem',
  'lecture slides pdf',
  'lecture notes central limit theorem sample mean',
  'reading response',
  'review session office hours',
  'private notes unpicked',
];

// ------------------------------------------------------------------------------------------------------- sharing
/** Share (or unshare) a user's connections into a squad. `all` skips calendar kinds by design. */
export async function shareToSquad(
  u: WorldUser,
  squadId: string,
  o: { connectionId?: string; all?: boolean; sourceIds?: string[]; shared?: boolean } = {},
) {
  const ids = o.connectionId
    ? [o.connectionId]
    : (await listConnections(u)).connections.filter((c) => c.status !== 'revoked').map((c) => c.id);
  const out: { id: string; status: number; json: any }[] = [];
  for (const id of ids) {
    const json: Record<string, unknown> = { squadId, shared: o.shared ?? true };
    if (o.sourceIds) json.sourceIds = o.sourceIds;
    if (o.all ?? !o.sourceIds) json.all = true;
    const r = await api(u.token, ROUTES.connectionShare(id), { method: 'POST', json });
    out.push({ id, status: r.status, json: r.json });
  }
  return out;
}

/** The per-squad opt-in: every non-calendar source of every connection becomes readable by the squad (or stops). */
export async function optIn(u: WorldUser, squadId: string, on = true) {
  return shareToSquad(u, squadId, { all: true, shared: on });
}

/** DELETE: revoke upstream, delete tokens and every derived row. `remove` also drops the empty revoked row. */
export async function disconnect(u: WorldUser, id: string, o: { remove?: boolean } = {}) {
  return api(u.token, `${ROUTES.connection(id)}${o.remove ? '?remove=1' : ''}`, {
    method: 'DELETE',
  });
}
export const revoke = disconnect;
export async function disconnectAll(u: WorldUser) {
  const out = [];
  for (const c of (await listConnections(u)).connections.filter((x) => x.status !== 'revoked'))
    out.push(await disconnect(u, c.id));
  return out;
}

// ------------------------------------------------------------------------------------------------------ retrieval
export async function searchContext(
  u: WorldUser,
  q: string,
  o: { squadId?: string; limit?: number; kind?: string; courseId?: string } = {},
) {
  const p = new URLSearchParams({ q });
  if (o.limit) p.set('limit', String(o.limit));
  if (o.kind) p.set('kind', o.kind);
  if (o.courseId) p.set('courseId', o.courseId);
  const r = await api(u.token, `${ROUTES.contextSearch}?${p.toString()}`, {
    headers: o.squadId ? { 'x-squad-id': o.squadId } : {},
  });
  return { ...r, results: (r.status === 200 ? (r.json?.results ?? []) : []) as Hit[] };
}
export const hitSourceIds = (hits: { sourceId: string }[]) => asSet(hits.map((h) => h.sourceId));

/** The citation source viewer's data call. `quote` is verified verbatim against the cited chunk server side. */
export async function openSource(
  u: WorldUser,
  ref: { id: string; kind?: string; anchor?: string },
  quote?: string,
  squadId?: string,
) {
  const p = new URLSearchParams({ id: ref.id });
  if (ref.kind) p.set('kind', ref.kind);
  if (ref.anchor) p.set('anchor', ref.anchor);
  if (quote) p.set('quote', quote);
  return api(u.token, `${ROUTES.contextSource}?${p.toString()}`, {
    headers: squadId ? { 'x-squad-id': squadId } : {},
  });
}

// ------------------------------------------------------------------------------------------------ upstream chaos
/**
 * Variant helpers over the fakes' HTTP controls. The hub only refreshes a Google token within 60 s of its expiry, so
 * for refresh cases connect with `connectGoogle(u, { shortLived: true })` first, then `expireUpstream()`, then list
 * connections (GET /v1/connections runs the credential tick).
 */
export async function revokeUpstream(provider: 'google' | 'canvas' = 'google') {
  if (provider === 'google') await google.revoke();
  else await canvas.tokenValid(false);
  return { ok: true };
}

/** Access tokens past their life. Refresh works unless `refreshFails` (then the connection ends `expired`). */
export async function expireUpstream(o: { refreshFails?: boolean } = {}) {
  await google.expire();
  if (o.refreshFails) await google.failRefresh(99);
  return { ok: true };
}

/** The Canvas upstream misbehaves: 404, 410, a redirect, a rate limit, or a revoked/invalid token. */
export async function canvasFeedBroken(
  mode: 'ok' | '404' | '410' | 'moved' | 'rate_limited' | 'big' | 'bad_token',
) {
  if (mode === 'bad_token') await canvas.tokenValid(false);
  else await canvas.mode(mode);
  return { ok: true };
}

export async function resetUpstreams() {
  await canvas.reset();
  await google.reset();
  return { ok: true };
}

/** The sources the user owns across every connection. */
export const sourcesOf = (u: WorldUser) => items(u);

/** Makes a later step self-sufficient: connects whatever is missing and (with a squadId) opts the squad in. */
export async function ensureConnected(u: WorldUser, squadId?: string): Promise<boolean> {
  const active = (await listConnections(u)).connections.filter((c) => c.status !== 'revoked');
  let did = false;
  if (
    !active.some((c) => c.provider === 'canvas') ||
    !active.some((c) => c.provider === 'google')
  ) {
    await connectEverything(u);
    did = true;
  }
  if (squadId && !(await items(u)).some((s) => s.sharedWith.includes(squadId))) {
    await optIn(u, squadId, true);
    did = true;
  }
  return did;
}

// ------------------------------------------------------------------------------------------------------- chat
/** Send as a web user into the squad group chat; resolves with the bot reply that follows. */
export async function ask(u: WorldUser, chatId: string, text: string, ms = 45_000) {
  const before = (await history(u.token, chatId)).reduce((n, m) => Math.max(n, m.seq), 0);
  const sent = await api(u.token, '/v1/chat/send', { method: 'POST', json: { chatId, text } });
  const reply = await waitBot(u.token, chatId, () => true, before, ms);
  return { sent, reply, before };
}

/** Bind the world's squad A group chat by texting `join <code>` from Rhea's phone. */
export async function bindGroup(w: World, which: 'A' | 'B' = 'A') {
  const sq = which === 'A' ? w.squadA : w.squadB!;
  const owner = which === 'A' ? w.users.rhea : w.users.dan!;
  await im.say(sq.chat, owner.phone, `join ${sq.invite}`);
  return sq;
}

/** Outbound texts the fake Apple received for a chat, minus the join confirmation. */
export async function outboundTo(chat: string): Promise<string[]> {
  const r = await im.sent(chat);
  return r.sent.map((s) => s.text ?? '').filter((t) => !/joined|welcome|you're in|linked/i.test(t));
}

export const hubBots = (msgs: HMsg[]) => msgs.filter(isBot);

/** Every table row JSON from the hub DB (gate-hub control), for storage-level assertions. */
export async function dbRows(table: string): Promise<any[]> {
  const dump = JSON.parse(await im.dbDump()) as Record<string, any[]>;
  return dump[table] ?? [];
}
export const sentinelInDb = async (needle: string) => (await im.dbDump()).includes(needle);

export const SENT = SENTINELS;
