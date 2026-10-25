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
  };
}

const ErrorBody = z.looseObject({ error: z.looseObject({ code: z.string() }) });
const List = z.looseObject({ connections: z.array(RawConnection) });
const One = z.looseObject({ connection: RawConnection });
const Squads = z.looseObject({ activeSquadId: z.string().nullable().optional() });
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
    }),
  ),
});
export interface SourceRow {
  id: string;
  kind: string;
  title: string;
  sharedWith: string[];
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
    return (await call(ctx, 'GET', `/v1/connections/${enc(id)}/sources`, SourceRows)).sources;
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
  async pair() {
    return call(ctx, 'POST', '/v1/connections/extension/pair', Pair, {});
  },
  async googleAuthorize(returnTo: string) {
    return call(
      ctx,
      'GET',
      `/v1/connections/google/authorize?return_to=${enc(returnTo)}`,
      Authorize,
    );
  },
});
export type HubClient = ReturnType<typeof hub>;
