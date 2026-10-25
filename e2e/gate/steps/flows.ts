/* eslint-disable @typescript-eslint/no-explicit-any -- the gate reads untyped hub JSON */
// Reusable journey fragments (used by the steps and by the variants). All are API-level and side-effect aware.
// Aligned to the REAL hub contract (lib/contract.ts): /v1/connections*, /v1/context/search|source, Google authorize +
// /oauth/google/callback through the hub's labelled consent simulator. The hub's fixture upstreams are in-process, so
// upstream misbehaviour goes through the gate-hub control server (hubCtx).
import { SENTINELS } from '../lib/config';
import { api, history, isBot, waitBot, type HMsg } from '../lib/hub';
import { canvas, google, hubCtx, im, type World, type WorldUser } from '../lib/fakes/client';
import { HUB_FIXTURE } from '../lib/fakes/content';
import {
  CANVAS_FIXTURE_BASE,
  CANVAS_SCOPE,
  CANVAS_SECRET,
  ROUTES,
  type UpstreamBehavior,
} from '../lib/contract';

export const asSet = (x: string[]) => [...new Set(x)].sort();
const quiet = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch {
    /* the HTTP fakes are optional: the hub cannot reach them today */
  }
};

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

/** Canvas through the student-token variant in fixture mode (assignments, announcement, file with page text). */
export async function connectCanvas(u: WorldUser, variant: 'token' | 'feed' = 'token') {
  const body =
    variant === 'token'
      ? {
          provider: 'canvas',
          variant: 'token',
          scopes: [CANVAS_SCOPE.token],
          token: CANVAS_SECRET,
          baseUrl: CANVAS_FIXTURE_BASE,
        }
      : {
          provider: 'canvas',
          variant: 'feed',
          scopes: [CANVAS_SCOPE.feed],
          feedUrl: `${CANVAS_FIXTURE_BASE}/feeds/${CANVAS_SECRET}/calendar.ics`,
        };
  return api(u.token, ROUTES.connections, { method: 'POST', json: body });
}

const unesc = (s: string) => s.replace(/&amp;/g, '&');

/**
 * The whole Nook-shaped Google consent dance against the hub's labelled simulator: authorize -> consent page -> callback.
 * `picked` are the Drive Picker selections (drive.file is per file). `deny` clicks Cancel instead of Allow.
 */
export async function connectGoogle(
  u: WorldUser,
  opts: { picked?: string[]; replayCallback?: boolean; deny?: boolean; returnTo?: string } = {},
) {
  const picked = opts.picked ?? [HUB_FIXTURE.google.picked.id];
  const q = new URLSearchParams({ return_to: opts.returnTo ?? '/squad/connections' });
  if (picked.length) q.set('picked', picked.join(','));
  const auth = await api(u.token, `${ROUTES.googleAuthorize}?${q.toString()}`);
  const url: string | undefined = auth.json?.authorization_url;
  if (auth.status !== 200 || !url)
    return { ok: false as const, why: `authorize answered ${auth.status}`, auth };
  const consentUrl = new URL(url);
  if (consentUrl.pathname !== ROUTES.googleSimConsent)
    return {
      ok: false as const,
      why: 'authorization_url is not the hub simulator (hub is in live mode)',
      auth,
    };
  const consent = await api(null, consentUrl.pathname + consentUrl.search);
  const allow = /href="([^"]*code=sim[^"]*)"/.exec(consent.text)?.[1];
  const cancel = /href="([^"]*error=access_denied[^"]*)"/.exec(consent.text)?.[1];
  const target = opts.deny ? cancel : allow;
  if (!target)
    return { ok: false as const, why: 'consent page has no allow/cancel link', auth, consent };
  const first = await api(null, unesc(target));
  const replay = opts.replayCallback ? await api(null, unesc(target)) : undefined;
  return {
    ok: true as const,
    auth,
    mode: auth.json?.mode as string,
    /** scopes the hub says it requests */
    requested: (auth.json?.scopes ?? []) as string[],
    consentHtml: consent.text,
    /** scope names the consent page lists (last path segment) */
    consentScopes: [...consent.text.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]!),
    callbackStatus: first.status,
    location: first.headers.get('location') ?? '',
    replayStatus: replay?.status,
    state: consentUrl.searchParams.get('state') ?? '',
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
  'sampling distributions assignment',
  'confidence intervals assignment',
  'osmosis potato cores lab report',
  'midterm review session moved Thursday room',
  'week5 sampling lecture central limit theorem standard error',
  'sampling distributions my notes',
  'study group library annex sampling distributions',
  'office hours teaching assistant confidence intervals',
  'class survey summary commute time',
  'reflection when does the mean mislead',
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
 * Variant helpers. They drive the hub's in-process fixture upstreams through the gate-hub control server and, best
 * effort, the HTTP fakes (a hub with a base-URL override would use those). Each returns whether the hub-side control
 * was reachable so a variant can report `BLOCKED`/note instead of silently passing.
 */
export async function revokeUpstream(provider: 'google' | 'canvas' = 'google') {
  const r = await hubCtx.upstream(provider, 'revoked');
  if (provider === 'google') await quiet(google.revoke());
  return { hubControl: r.ok, status: r.status };
}

/** Access token past its life. Refresh works unless `refreshFails` (then the connection ends `expired`, needs reconnect). */
export async function expireUpstream(
  o: { provider?: 'google' | 'canvas'; refreshFails?: boolean } = {},
) {
  const provider = o.provider ?? 'google';
  const a = await hubCtx.upstream(provider, 'ok', o.refreshFails ?? false);
  const b = await hubCtx.expireClock(provider);
  if (provider === 'google') {
    await quiet(google.expire());
    if (o.refreshFails) await quiet(google.failRefresh(99));
  }
  return { hubControl: a.ok && b.ok, status: b.status };
}

/** The Canvas feed/token upstream misbehaves. The in-process fixture cannot speak HTTP, so statuses map to behaviours. */
export async function canvasFeedBroken(mode: 'ok' | '404' | '410' | 'moved' | UpstreamBehavior) {
  const behavior: UpstreamBehavior =
    mode === '404' || mode === 'moved' ? 'unauthorized' : mode === '410' ? 'revoked' : mode;
  const r = await hubCtx.upstream('canvas', behavior);
  if (mode === 'ok' || mode === '404' || mode === '410' || mode === 'moved')
    await quiet(canvas.mode(mode));
  return { hubControl: r.ok, status: r.status, behavior };
}

export async function resetUpstreams() {
  const r = await hubCtx.reset();
  await quiet(canvas.reset());
  await quiet(google.reset());
  return { hubControl: r.ok };
}

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
