import { randomBytes } from 'node:crypto';
import {
  ALLOWED_SCOPES,
  CANVAS_SCOPES,
  ConnectorExpiredError,
  GOOGLE_SCOPES,
  createContextStore,
  createFakeCanvasConnector,
  createFakeGoogleConnector,
  hashExternalAccount,
  syncConnection,
  type CanvasAuth,
  type CanvasConnector,
  type ContextConnection,
  type ContextStore,
  type FakeControls,
  type GoogleAuth,
  type GoogleConnector,
  type Provider,
  type SyncReport,
} from '@squad/brain';
import type { HubDeps } from '../types';
import { createTokenStore, type TokenSecrets, type TokenStore } from './tokens';

export interface ContextService {
  store: ContextStore;
  tokens: TokenStore;
  connectors: {
    canvas: CanvasConnector & { controls?: FakeControls };
    google: GoogleConnector & { controls?: FakeControls };
  };
  /** Always `fixture` until a real OAuth client / institution grant exists. */
  mode: 'fixture' | 'live';
  connect(userId: string, input: ConnectInput): Promise<ConnectResult>;
  sync(userId: string, connectionId: string): Promise<SyncReport | undefined>;
  /** Refreshes or expires credentials whose clock ran out; cheap, called before every listing. */
  tick(connectionId: string): Promise<void>;
  disconnect(
    userId: string,
    connectionId: string,
  ): Promise<{ purged: { sources: number; chunks: number } } | undefined>;
}

export interface ConnectInput {
  provider: Provider;
  variant?: string | undefined;
  scopes: string[];
  feedUrl?: string | undefined;
  token?: string | undefined;
  baseUrl?: string | undefined;
  pickedFileIds?: string[] | undefined;
}

export type ConnectResult =
  | { ok: true; connection: ContextConnection; sync: SyncReport }
  | {
      ok: false;
      code:
        'scope_not_allowed' | 'invalid_request' | 'already_connected' | 'token_store_unconfigured';
      message: string;
    };

const HOUR = 3_600_000;
/** Private/loopback hosts are never accepted as a Canvas URL (SSRF guard for the future real connector). */
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\d{1,3}(\.\d{1,3}){3}|\[.*\])$/i;

function safeHttps(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname) || u.username || u.password)
      return null;
    return u;
  } catch {
    return null;
  }
}

export function createContextService(
  deps: HubDeps,
  opts: {
    keyEnv?: string | undefined;
    canvas?: ContextService['connectors']['canvas'];
    google?: ContextService['connectors']['google'];
  } = {},
): ContextService {
  const store = createContextStore(deps.db);
  const tokens = createTokenStore(deps.db, {
    keyEnv: 'keyEnv' in opts ? opts.keyEnv : process.env.CONTEXT_TOKEN_KEY,
    fallbackSecret: deps.config.sessionSecret,
    production: deps.config.production,
    now: deps.now,
  });
  const connectors = {
    canvas: opts.canvas ?? createFakeCanvasConnector(),
    google: opts.google ?? createFakeGoogleConnector(),
  };
  const newId = () => `conn_${randomBytes(9).toString('hex')}`;

  const authFor = (c: ContextConnection, s: TokenSecrets): CanvasAuth | GoogleAuth =>
    c.provider === 'canvas'
      ? c.variant === 'feed'
        ? { variant: 'feed', feedUrl: s.feedUrl ?? '' }
        : { variant: 'token', token: s.apiToken ?? '', baseUrl: s.baseUrl ?? '' }
      : {
          accessToken: s.accessToken ?? '',
          ...(s.refreshToken ? { refreshToken: s.refreshToken } : {}),
          scopes: c.scopes,
          pickedFileIds: s.pickedFileIds ?? [],
        };

  const svc: ContextService = {
    store,
    tokens,
    connectors,
    mode: 'fixture',

    async connect(userId, input) {
      const allowed = ALLOWED_SCOPES[input.provider];
      if (input.scopes.length === 0 || input.scopes.some((s) => !allowed.includes(s)))
        return {
          ok: false,
          code: 'scope_not_allowed',
          message:
            'Only the minimal read-only scopes listed in docs/context-store.md are accepted.',
        };
      const secrets: TokenSecrets = {};
      let variant: string;
      let auth: CanvasAuth | GoogleAuth;
      if (input.provider === 'canvas') {
        variant = input.variant === 'token' ? 'token' : 'feed';
        const wantScope = variant === 'feed' ? CANVAS_SCOPES.feed : CANVAS_SCOPES.token;
        if (!input.scopes.includes(wantScope) || input.scopes.length !== 1)
          return {
            ok: false,
            code: 'invalid_request',
            message: `Scopes for a Canvas ${variant} connection must be exactly [${wantScope}].`,
          };
        if (variant === 'feed') {
          const u = safeHttps(input.feedUrl);
          if (!u)
            return {
              ok: false,
              code: 'invalid_request',
              message: 'feedUrl must be an https Canvas calendar feed URL.',
            };
          secrets.feedUrl = u.toString();
          auth = { variant: 'feed', feedUrl: secrets.feedUrl };
        } else {
          const b = safeHttps(input.baseUrl);
          if (!b || !input.token)
            return {
              ok: false,
              code: 'invalid_request',
              message: 'token and an https baseUrl are required.',
            };
          secrets.apiToken = input.token;
          secrets.baseUrl = b.origin;
          auth = { variant: 'token', token: input.token, baseUrl: b.origin };
        }
      } else {
        variant = 'oauth';
        // No consent flow yet: in fixture mode the hub mints placeholder tokens, so nothing real is requested.
        secrets.accessToken = `fixture-access-${randomBytes(8).toString('hex')}`;
        secrets.refreshToken = `fixture-refresh-${randomBytes(8).toString('hex')}`;
        secrets.pickedFileIds = input.pickedFileIds ?? [];
        auth = {
          accessToken: secrets.accessToken,
          refreshToken: secrets.refreshToken,
          scopes: input.scopes,
          pickedFileIds: input.pickedFileIds ?? [],
        };
      }
      const connector = input.provider === 'canvas' ? connectors.canvas : connectors.google;
      const accountHash = hashExternalAccount(
        deps.config.contactPepper,
        input.provider,
        await (connector as { accountId(a: unknown): Promise<string> }).accountId(auth),
      );
      if (
        store
          .connectionsOf(userId)
          .some(
            (c) =>
              c.provider === input.provider &&
              c.accountHash === accountHash &&
              c.status !== 'revoked',
          )
      )
        return {
          ok: false,
          code: 'already_connected',
          message: 'This account is already connected. Disconnect it first to reconnect.',
        };
      const id = newId();
      try {
        tokens.put(id, secrets);
      } catch {
        return {
          ok: false,
          code: 'token_store_unconfigured',
          message: 'Token storage is not configured on this server.',
        };
      }
      const conn: ContextConnection = {
        id,
        ownerId: userId,
        provider: input.provider,
        mode: 'fixture',
        variant,
        accountHash,
        scopes: [...input.scopes],
        status: 'live',
        degraded: false,
        statusNote: null,
        createdAt: deps.now(),
        lastSyncAt: null,
        expiresAt: input.provider === 'google' ? deps.now() + HOUR : null,
      };
      store.upsertConnection(conn);
      const sync = (await svc.sync(userId, id)) as SyncReport;
      return { ok: true, connection: store.connection(id)!, sync };
    },

    async tick(connectionId) {
      const c = store.connection(connectionId);
      if (!c || c.status !== 'live' || c.expiresAt === null || c.expiresAt > deps.now() + 60_000)
        return;
      const s = tokens.get(c.id);
      const connector = c.provider === 'google' ? connectors.google : undefined;
      if (s?.refreshToken && connector?.refresh) {
        try {
          const r = await connector.refresh(authFor(c, s) as GoogleAuth);
          tokens.put(c.id, { ...s, accessToken: r.accessToken });
          store.patchConnection(c.id, { expiresAt: Math.max(r.expiresAt ?? 0, deps.now() + HOUR) });
          return;
        } catch (e) {
          if (!(e instanceof ConnectorExpiredError))
            deps.log.warn('context.refresh_failed', { connectionId: c.id });
        }
      }
      store.setStatus(
        c.id,
        'expired',
        'The credential expired and could not be renewed. Reconnect to resume syncing.',
      );
    },

    async sync(userId, connectionId) {
      const c = store.connection(connectionId);
      if (!c || c.ownerId !== userId) return undefined;
      await svc.tick(c.id);
      const fresh = store.connection(c.id)!;
      const s = tokens.get(c.id);
      if (!s && fresh.status !== 'revoked') {
        store.setStatus(c.id, 'error', 'Stored credential is missing. Reconnect.', true);
        return {
          outcome: 'error',
          added: 0,
          updated: 0,
          unchanged: 0,
          duplicates: 0,
          removed: 0,
          failed: 0,
        };
      }
      const auth = authFor(fresh, s ?? {});
      const report =
        fresh.provider === 'canvas'
          ? await syncConnection(
              { store, now: deps.now },
              fresh,
              connectors.canvas,
              auth as CanvasAuth,
            )
          : await syncConnection(
              { store, now: deps.now },
              fresh,
              connectors.google,
              auth as GoogleAuth,
            );
      if (report.outcome === 'revoked') tokens.delete(c.id);
      deps.log.info('context.sync', {
        connectionId: c.id,
        provider: c.provider,
        outcome: report.outcome,
        added: report.added,
        removed: report.removed,
      });
      return report;
    },

    async disconnect(userId, connectionId) {
      const c = store.connection(connectionId);
      if (!c || c.ownerId !== userId) return undefined;
      const s = tokens.get(c.id);
      if (s && c.status !== 'revoked') {
        try {
          const a = authFor(c, s);
          if (c.provider === 'canvas') await connectors.canvas.revoke(a as CanvasAuth);
          else await connectors.google.revoke(a as GoogleAuth);
        } catch {
          deps.log.warn('context.upstream_revoke_failed', {
            connectionId: c.id,
            provider: c.provider,
          });
        }
      }
      tokens.delete(c.id);
      const purged = store.revokeConnection(c.id, 'revoked', deps.now());
      deps.log.info('context.disconnect', {
        connectionId: c.id,
        provider: c.provider,
        sources: purged.sources,
      });
      return { purged };
    },
  };
  return svc;
}

/** Lazily builds the service on first use (same pattern as the live service). */
export function contextServiceFor(deps: HubDeps): ContextService {
  deps.context ??= createContextService(deps);
  return deps.context;
}

export { GOOGLE_SCOPES };
