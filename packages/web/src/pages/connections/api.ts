import { z } from 'zod';
import { timedFetch } from '../../lib/http';
import { STATE_COPY, STATES, type ConnState } from './model';

export class ConnError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}
interface Ctx {
  hubUrl: string;
  token: string | null;
}

const StateEnum = z.enum(STATES);
const RawConnection = z.looseObject({
  id: z.string(),
  provider: z.enum(['canvas', 'google']),
  variant: z.string().optional(),
  mode: z.enum(['fixture', 'live']),
  modeLabel: z.string().optional(),
  status: z.enum(['live', 'expired', 'revoked', 'error']),
  state: StateEnum.optional(),
  stateLabel: z.string().optional(),
  statusLabel: z.string().optional(),
  retryAfter: z.number().nullish(),
  syncPhase: z.enum(['idle', 'syncing']).optional(),
  cursor: z
    .object({
      updatedAt: z.number().nullable(),
      windowFrom: z.number().nullable().optional(),
      windowTo: z.number().nullable().optional(),
    })
    .nullish(),
  lastOutcome: z.string().nullish(),
  degraded: z.boolean().optional(),
  note: z.string().nullish(),
  scopes: z.array(z.string()).default([]),
  lastSyncAt: z.number().nullable(),
  expiresAt: z.number().nullable().optional(),
  canSync: z.boolean().optional(),
  syncVia: z.enum(['extension', 'hub']).optional(),
  sources: z.object({ total: z.number(), byKind: z.record(z.string(), z.number()) }),
  sharedWithSquads: z.array(z.string()).default([]),
  needsReconnect: z.boolean().optional(),
  /** The CHOSEN account, already masked by the hub (e.g. `a***@gmail.com`; Canvas host + signed-in user name). */
  account: z
    .looseObject({
      label: z.string(),
      name: z.string().nullish(),
      host: z.string().nullish(),
    })
    .nullish(),
  grantedScopes: z.array(z.string()).optional(),
});

export interface Connection {
  id: string;
  provider: 'canvas' | 'google';
  variant: string;
  mode: 'fixture' | 'live';
  state: ConnState;
  stateLabel: string;
  retryAfter: number | null;
  syncPhase: 'idle' | 'syncing';
  cursor: { updatedAt: number | null; windowFrom: number | null; windowTo: number | null } | null;
  lastOutcome: string | null;
  note: string | null;
  scopes: string[];
  lastSyncAt: number | null;
  canSync: boolean;
  /** `extension`: syncs happen in the browser (Canvas session), not from the hub. */
  syncVia: 'extension' | 'hub';
  sources: { total: number; byKind: Record<string, number> };
  sharedWithSquads: string[];
  /** The grant is gone or could not be renewed: show a Reconnect button. */
  needsReconnect: boolean;
  account: { label: string; name: string | null; host: string | null } | null;
  /** Scopes Google/Canvas actually granted (falls back to the requested scopes). */
  grantedScopes: string[];
}

/** Only the allow-listed fields are kept: anything else the hub might send (it should send no secrets) is dropped. */
export function toConnection(raw: z.infer<typeof RawConnection>): Connection {
  const state: ConnState =
    raw.state ??
    (raw.status === 'live' ? (raw.mode === 'fixture' ? 'fixture' : 'live') : raw.status);
  return {
    id: raw.id,
    provider: raw.provider,
    variant: raw.variant ?? '',
    mode: raw.mode,
    state,
    stateLabel: raw.stateLabel ?? raw.statusLabel ?? STATE_COPY[state],
    retryAfter: raw.retryAfter ?? null,
    syncPhase: raw.syncPhase ?? 'idle',
    cursor: raw.cursor
      ? {
          updatedAt: raw.cursor.updatedAt,
          windowFrom: raw.cursor.windowFrom ?? null,
          windowTo: raw.cursor.windowTo ?? null,
        }
      : null,
    lastOutcome: raw.lastOutcome ?? null,
    note: raw.note ?? null,
    scopes: raw.scopes,
    lastSyncAt: raw.lastSyncAt,
    canSync: raw.canSync ?? (raw.status === 'live' || raw.status === 'error'),
    syncVia: raw.syncVia ?? (raw.variant === 'session' ? 'extension' : 'hub'),
    sources: raw.sources,
    sharedWithSquads: raw.sharedWithSquads,
    needsReconnect: raw.needsReconnect ?? (state === 'expired' || state === 'revoked'),
    account: raw.account
      ? { label: raw.account.label, name: raw.account.name ?? null, host: raw.account.host ?? null }
      : null,
    grantedScopes: raw.grantedScopes ?? raw.scopes,
  };
}

const ErrorBody = z.looseObject({ error: z.looseObject({ code: z.string() }) });
const List = z.looseObject({ connections: z.array(RawConnection) });
const One = z.looseObject({ connection: RawConnection });
const Squads = z.looseObject({
  activeSquadId: z.string().nullable().optional(),
  squads: z.array(z.looseObject({ id: z.string(), name: z.string() })).default([]),
});
const Purge = z.looseObject({
  purged: z.object({ sources: z.number(), chunks: z.number() }).optional(),
  removed: z.boolean().optional(),
});
const Pair = z.object({ code: z.string(), expiresAt: z.number() });
const Authorize = z.object({ authorization_url: z.string(), mode: z.enum(['live', 'fixture']) });
const SourceRows = z.looseObject({
  sources: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.string(),
      title: z.string(),
      sharedWith: z.array(z.string()).default([]),
      courseId: z.string().nullish(),
      dueAt: z.number().nullish(),
      startsAt: z.number().nullish(),
      modifiedAt: z.number().nullish(),
      fetchedAt: z.number().nullish(),
      provenance: z.string().nullish(),
      url: z.string().nullish(),
    }),
  ),
});
export interface SourceRow {
  id: string;
  kind: string;
  title: string;
  sharedWith: string[];
  courseId: string | null;
  dueAt: number | null;
  startsAt: number | null;
  fetchedAt: number | null;
  /** `fixture` is simulated data, never the person's account. */
  provenance: 'real' | 'fixture';
}

async function call<T>(
  ctx: Ctx,
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    // timedFetch: a read that never answers ends in the offline state with Retry, not "Loading connections" forever
    res = await timedFetch(`${ctx.hubUrl}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(ctx.token ? { Authorization: `Bearer ${ctx.token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ConnError('offline');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = ErrorBody.safeParse(json);
    throw new ConnError(e.success ? e.data.error.code : `http_${res.status}`);
  }
  const p = schema.safeParse(json);
  if (!p.success) throw new ConnError('bad_response');
  return p.data;
}

const enc = encodeURIComponent;
export const hub = (ctx: Ctx) => ({
  async list(): Promise<Connection[]> {
    return (await call(ctx, 'GET', '/v1/connections', List)).connections.map(toConnection);
  },
  async activeSquad(): Promise<string | null> {
    return (await call(ctx, 'GET', '/v1/squads', Squads)).activeSquadId ?? null;
  },
  /** The viewer's squads by id, so the page can show names, never raw ids. */
  async squadNames(): Promise<Record<string, string>> {
    const r = await call(ctx, 'GET', '/v1/squads', Squads);
    return Object.fromEntries(r.squads.map((x) => [x.id, x.name]));
  },
  async sync(id: string): Promise<Connection> {
    return toConnection(
      (await call(ctx, 'POST', `/v1/connections/${enc(id)}/sync`, One)).connection,
    );
  },
  async disconnect(id: string, remove = false) {
    const r = await call(
      ctx,
      'DELETE',
      `/v1/connections/${enc(id)}${remove ? '?remove=1' : ''}`,
      Purge,
    );
    return r.purged ?? { sources: 0, chunks: 0 };
  },
  async sources(id: string): Promise<SourceRow[]> {
    // Adapter: when the hub ships GET /v1/connections/items this is the one place to switch.
    return (await call(ctx, 'GET', `/v1/connections/${enc(id)}/sources`, SourceRows)).sources.map(
      (s) => ({
        id: s.id,
        kind: s.kind,
        title: s.title,
        sharedWith: s.sharedWith,
        courseId: s.courseId ?? null,
        dueAt: s.dueAt ?? null,
        startsAt: s.startsAt ?? null,
        fetchedAt: s.fetchedAt ?? null,
        provenance: (s.provenance ?? '').endsWith(':fixture')
          ? ('fixture' as const)
          : ('real' as const),
      }),
    );
  },
  async share(
    id: string,
    input: { squadId: string; sourceIds?: string[]; all?: boolean; shared: boolean },
  ) {
    await call(ctx, 'POST', `/v1/connections/${enc(id)}/share`, z.looseObject({}), input);
  },
  async connectFeed(feedUrl: string): Promise<Connection> {
    const r = await call(
      ctx,
      'POST',
      '/v1/connections',
      z.looseObject({ connection: RawConnection }),
      {
        provider: 'canvas',
        variant: 'feed',
        scopes: ['canvas.calendar_feed'],
        feedUrl,
      },
    );
    return toConnection(r.connection);
  },
  /** Optional advanced fallback: a student-generated Canvas API token (some schools do not allow tokens). */
  async connectToken(baseUrl: string, token: string): Promise<Connection> {
    const r = await call(
      ctx,
      'POST',
      '/v1/connections',
      z.looseObject({ connection: RawConnection }),
      {
        provider: 'canvas',
        variant: 'token',
        mode: 'live',
        scopes: ['canvas.api_token.read'],
        baseUrl,
        token,
      },
    );
    return toConnection(r.connection);
  },
  /** Demo workspace: example items, labelled Demo data everywhere. No real account is read. */
  async connectDemo(provider: 'canvas' | 'google'): Promise<Connection> {
    const body =
      provider === 'canvas'
        ? {
            provider,
            variant: 'feed',
            scopes: ['canvas.calendar_feed'],
            feedUrl: 'https://canvas.demo.example/feeds/calendars/demo.ics',
          }
        : {
            provider,
            mode: 'fixture',
            scopes: [
              'https://www.googleapis.com/auth/calendar.readonly',
              'https://www.googleapis.com/auth/drive.file',
              'https://www.googleapis.com/auth/classroom.courses.readonly',
              'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
            ],
          };
    const r = await call(
      ctx,
      'POST',
      '/v1/connections',
      z.looseObject({ connection: RawConnection }),
      body,
    );
    return toConnection(r.connection);
  },
  async pair() {
    return call(ctx, 'POST', '/v1/connections/extension/pair', Pair, {});
  },
  async googleAuthorize(returnTo: string) {
    return call(
      ctx,
      'GET',
      `/v1/connections/google/authorize?return_to=${enc(returnTo)}&return_origin=${enc(typeof window === 'undefined' ? '' : window.location.origin)}`,
      Authorize,
    );
  },
});
export type HubClient = ReturnType<typeof hub>;
