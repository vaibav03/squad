import { createHmac, randomBytes } from 'node:crypto';
import {
  ALLOWED_SCOPES,
  CANVAS_SCOPES,
  ConnectorAuthError,
  ConnectorExpiredError,
  ConnectorRevokedError,
  expiredNote,
  revokedNote,
  ConnectorRateLimitError,
  GOOGLE_SCOPES,
  buildGoogleAuthorizationUrl,
  createLiveCanvasConnector,
  createLiveGoogleConnector,
  createPushedCanvasConnector,
  exchangeGoogleCode,
  googleOAuthConfigured,
  googleUserinfo,
  isExactHttpsOrigin,
  type CanvasSyncPayload,
  type GoogleOAuthConfig,
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
import { createExtensionAuth, type ExtensionAuth } from './extension-auth';
import { createTokenStore, type TokenSecrets, type TokenStore } from './tokens';

export interface ContextService {
  store: ContextStore;
  tokens: TokenStore;
  connectors: {
    /** Synthetic upstreams (mode `fixture`). */
    canvas: CanvasConnector & { controls?: FakeControls };
    google: GoogleConnector & { controls?: FakeControls };
    /** Real upstreams (mode `live`): Canvas REST with a student token, Google Calendar / Drive / Classroom. */
    canvasLive: CanvasConnector;
    googleLive: GoogleConnector;
  };
  /**
   * `fixture` while Google has no configured OAuth client (the hub then runs a labelled consent simulator);
   * `live` once GOOGLE_OAUTH_* is set. Canvas connections carry their own mode (session and token are live).
   */
  mode: 'fixture' | 'live';
  /** Browser-extension pairing and scoped bearer (Nook's extension auth, adapted). */
  ext: ExtensionAuth;
  googleOAuth: GoogleOAuthConfig | undefined;
  /** Nook's `canvas-authorize` registration, hub side. */
  registerCanvasSession(userId: string, input: CanvasRegisterInput): CanvasRegisterResult;
  /** Nook's `canvas-accounts/:id/sync`, hub side: normalise the extension's payload into sources. */
  syncCanvasPayload(
    userId: string,
    connectionId: string,
    payload: CanvasSyncPayload,
  ): Promise<
    SyncReport | { error: 'canvas_session_mismatch' | 'not_found' | 'connection_revoked' }
  >;
  /** The extension tells us what Canvas answered when it could not sync (expired session, rate limit). */
  reportCanvasOutcome(
    userId: string,
    connectionId: string,
    outcome: 'expired' | 'rate_limited' | 'error',
    retryAfterMs?: number,
  ): boolean;
  startGoogleAuth(
    userId: string,
    input: {
      returnTo: string;
      pickedFileIds?: string[] | undefined;
      loginHint?: string | undefined;
    },
  ): { authorizationUrl: string; mode: 'live' | 'fixture' } | { error: 'invalid_return_to' };
  completeGoogleAuth(input: {
    state: string;
    code?: string | undefined;
    error?: string | undefined;
  }): Promise<{ redirect: string; userId: string } | { error: 'oauth_state_invalid' }>;
  connect(userId: string, input: ConnectInput): Promise<ConnectResult>;
  sync(userId: string, connectionId: string): Promise<SyncReport | undefined>;
  /** Refreshes or expires credentials whose clock ran out; cheap, called before every listing. */
  tick(connectionId: string): Promise<void>;
  disconnect(
    userId: string,
    connectionId: string,
  ): Promise<{ purged: { sources: number; chunks: number } } | undefined>;
}

export interface CanvasRegisterInput {
  canvasUserId: string;
  origin: string;
}
export type CanvasRegisterResult =
  | { ok: true; connection: ContextConnection; created: boolean }
  | {
      ok: false;
      code:
        | 'canvas_origin_not_allowed'
        | 'canvas_account_already_bound'
        | 'canvas_account_conflict'
        | 'invalid_request'
        | 'token_store_unconfigured';
    };

export interface ConnectInput {
  mode?: 'fixture' | 'live' | undefined;
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
        | 'scope_not_allowed'
        | 'invalid_request'
        | 'already_connected'
        | 'token_store_unconfigured'
        | 'credential_rejected'
        | 'rate_limited'
        | 'provider_unreachable';
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
    canvasLive?: CanvasConnector;
    googleLive?: GoogleConnector;
    /** Defaults to the GOOGLE_OAUTH_* environment (placeholders only in .env.example). */
    googleOAuth?: GoogleOAuthConfig | undefined | null;
    fetch?: typeof fetch;
  } = {},
): ContextService {
  const store = createContextStore(deps.db);
  const tokens = createTokenStore(deps.db, {
    keyEnv: 'keyEnv' in opts ? opts.keyEnv : process.env.CONTEXT_TOKEN_KEY,
    fallbackSecret: deps.config.sessionSecret,
    production: deps.config.production,
    now: deps.now,
  });
  const envOAuth: Partial<GoogleOAuthConfig> = {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.GOOGLE_OAUTH_REDIRECT_URI ?? `${deps.config.baseUrl}/oauth/google/callback`,
  };
  const oauth: GoogleOAuthConfig | undefined =
    opts.googleOAuth === null
      ? undefined
      : googleOAuthConfigured(opts.googleOAuth ?? envOAuth)
        ? (opts.googleOAuth ?? (envOAuth as GoogleOAuthConfig))
        : undefined;
  const connectors = {
    canvas: opts.canvas ?? createFakeCanvasConnector(),
    google: opts.google ?? createFakeGoogleConnector(),
    canvasLive:
      opts.canvasLive ?? createLiveCanvasConnector(opts.fetch ? { fetch: opts.fetch } : {}),
    googleLive:
      opts.googleLive ??
      createLiveGoogleConnector({
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(oauth ? { oauth } : {}),
      }),
  };
  const ext = createExtensionAuth(deps.db, deps.now);
  deps.db.exec(`CREATE TABLE IF NOT EXISTS ctx_oauth_states(
    state TEXT PRIMARY KEY, user_id TEXT NOT NULL, return_to TEXT NOT NULL, picked_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0)`);
  const newId = () => `conn_${randomBytes(9).toString('hex')}`;
  const OAUTH_TTL_MS = 30 * 60_000;
  /** PKCE verifier derived from the state with a server key: nothing secret to store, nothing to leak in the URL. */
  const verifierFor = (state: string) =>
    createHmac('sha256', deps.config.sessionSecret)
      .update(`pkce\u0000${state}`)
      .digest('base64url');
  const isLive = (c: ContextConnection) => c.mode === 'live';
  const sha = (v: string) =>
    createHmac('sha256', deps.config.contactPepper)
      .update(`origin\u0000${v}`)
      .digest('hex')
      .slice(0, 32);

  const authFor = (c: ContextConnection, s: TokenSecrets): CanvasAuth | GoogleAuth =>
    c.provider === 'canvas'
      ? c.variant === 'feed'
        ? { variant: 'feed', feedUrl: s.feedUrl ?? '' }
        : c.variant === 'session'
          ? { variant: 'session', origin: '', canvasUserId: '' }
          : { variant: 'token', token: s.apiToken ?? '', baseUrl: s.baseUrl ?? '' }
      : {
          accessToken: s.accessToken ?? '',
          ...(s.refreshToken ? { refreshToken: s.refreshToken } : {}),
          scopes: c.scopes,
          pickedFileIds: s.pickedFileIds ?? [],
        };
  const googleConnector = (c: ContextConnection) =>
    isLive(c) ? connectors.googleLive : connectors.google;
  const canvasConnector = (c: ContextConnection) =>
    isLive(c) ? connectors.canvasLive : connectors.canvas;
  const emptyReport = (outcome: SyncReport['outcome'], note?: string): SyncReport => ({
    outcome,
    added: 0,
    updated: 0,
    unchanged: 0,
    duplicates: 0,
    removed: 0,
    failed: 0,
    ...(note ? { note } : {}),
  });

  /** Google scopes the user actually granted, intersected with the minimal allowed set. */
  const grantedScopes = (raw: string | undefined, requested: readonly string[]): string[] => {
    const allowed = ALLOWED_SCOPES.google;
    const got = (raw ? raw.split(/\s+/) : [...requested]).filter((x) => allowed.includes(x));
    return [...new Set(got)];
  };

  const safeReturn = (v: string) => v.startsWith('/') && !v.startsWith('//') && !v.includes('\\');
  const webRedirect = (
    returnTo: string,
    status: 'connected' | 'error',
    mode: 'live' | 'fixture',
    message?: string,
  ) => {
    const u = new URL(
      safeReturn(returnTo) ? returnTo : '/settings/connections',
      deps.config.webUrl,
    );
    u.searchParams.set('provider', 'google');
    u.searchParams.set('status', status);
    u.searchParams.set('mode', mode);
    if (message) u.searchParams.set('message', Buffer.from(message).toString('base64url'));
    return u.toString();
  };

  const svc: ContextService = {
    store,
    tokens,
    connectors,
    ext,
    googleOAuth: oauth,
    mode: oauth ? 'live' : 'fixture',

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
      // Only a student-supplied Canvas token can be live without a registered OAuth client.
      const live =
        input.mode === 'live' && input.provider === 'canvas' && input.variant === 'token';
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
        // Fixture Google: placeholder tokens, nothing real is requested. Real Google goes through startGoogleAuth.
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
      const connector =
        input.provider === 'canvas'
          ? live
            ? connectors.canvasLive
            : connectors.canvas
          : connectors.google;
      let externalAccount: string;
      try {
        externalAccount = await (connector as { accountId(a: unknown): Promise<string> }).accountId(
          auth,
        );
      } catch (e) {
        if (e instanceof ConnectorAuthError)
          return {
            ok: false,
            code: 'credential_rejected',
            message: 'Canvas rejected this token. Check it and the Canvas address.',
          };
        if (e instanceof ConnectorRateLimitError)
          return {
            ok: false,
            code: 'rate_limited',
            message: 'Canvas asked us to slow down. Try again soon.',
          };
        return { ok: false, code: 'provider_unreachable', message: 'Could not reach Canvas.' };
      }
      const accountHash = hashExternalAccount(
        deps.config.contactPepper,
        input.provider,
        externalAccount,
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
        mode: live ? 'live' : 'fixture',
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

    registerCanvasSession(userId, input) {
      // Nook: exact https origins only (`canvas_origin_not_allowed`), and never an IP/localhost target.
      if (!isExactHttpsOrigin(input.origin) || !safeHttps(input.origin))
        return { ok: false, code: 'canvas_origin_not_allowed' };
      if (!/^\d{1,20}$/.test(input.canvasUserId)) return { ok: false, code: 'invalid_request' };
      const accountHash = hashExternalAccount(
        deps.config.contactPepper,
        'canvas',
        `${input.origin}#${input.canvasUserId}`,
      );
      const originHash = sha(input.origin);
      // Nook's rules: a Canvas login bound to someone else is refused (we do not disclose who);
      // a second, different login on the same origin for the same user is a conflict; same login reactivates.
      if (store.connectionsByAccount('canvas', accountHash).some((c) => c.ownerId !== userId))
        return { ok: false, code: 'canvas_account_already_bound' };
      const mine = store
        .connectionsOf(userId)
        .filter((c) => c.provider === 'canvas' && c.variant === 'session');
      const same = mine.find((c) => c.accountHash === accountHash && c.status !== 'revoked');
      if (same) {
        store.setStatus(same.id, 'live', null);
        return { ok: true, connection: store.connection(same.id)!, created: false };
      }
      if (
        mine.some((c) => c.status !== 'revoked' && store.syncState(c.id).originHash === originHash)
      )
        return { ok: false, code: 'canvas_account_conflict' };
      const id = newId();
      try {
        // The session variant holds no secret (the browser holds the cookies); an empty record keeps the model uniform.
        tokens.put(id, {});
      } catch {
        return { ok: false, code: 'token_store_unconfigured' };
      }
      store.upsertConnection({
        id,
        ownerId: userId,
        provider: 'canvas',
        mode: 'live',
        variant: 'session',
        accountHash,
        scopes: [CANVAS_SCOPES.session],
        status: 'live',
        degraded: false,
        statusNote: null,
        createdAt: deps.now(),
        lastSyncAt: null,
        expiresAt: null,
      });
      store.patchSyncState(id, { originHash });
      return { ok: true, connection: store.connection(id)!, created: true };
    },

    async syncCanvasPayload(userId, connectionId, payload) {
      const c = store.connection(connectionId);
      if (!c || c.ownerId !== userId || c.provider !== 'canvas' || c.variant !== 'session')
        return { error: 'not_found' };
      if (c.status === 'revoked') return { error: 'connection_revoked' };
      const expect = hashExternalAccount(
        deps.config.contactPepper,
        'canvas',
        `${payload.origin.replace(/\/+$/, '')}#${payload.canvas_user_id}`,
      );
      if (expect !== c.accountHash) return { error: 'canvas_session_mismatch' };
      // A push is the whole picture Canvas gave the extension, so it is a full pass (deletions detected).
      store.setStatus(c.id, 'live', null);
      store.patchSyncState(c.id, { retryAfter: null });
      const report = await syncConnection(
        { store, now: deps.now, full: true },
        store.connection(c.id)!,
        createPushedCanvasConnector(payload),
        { variant: 'session', origin: payload.origin, canvasUserId: payload.canvas_user_id },
      );
      deps.log.info('context.canvas_sync', {
        connectionId: c.id,
        outcome: report.outcome,
        added: report.added,
        updated: report.updated,
        removed: report.removed,
      });
      return report;
    },

    reportCanvasOutcome(userId, connectionId, outcome, retryAfterMs) {
      const c = store.connection(connectionId);
      if (!c || c.ownerId !== userId || c.variant !== 'session' || c.status === 'revoked')
        return false;
      if (outcome === 'expired')
        store.setStatus(
          c.id,
          'expired',
          'Your Canvas session ended. Sign in to Canvas in the browser and sync again; imported data is kept until you disconnect.',
        );
      else if (outcome === 'rate_limited') {
        store.setStatus(
          c.id,
          'rate_limited',
          'Canvas asked us to slow down. Try syncing again later.',
        );
        store.patchSyncState(c.id, {
          retryAfter: deps.now() + Math.max(1_000, retryAfterMs ?? 60_000),
        });
      } else
        store.setStatus(
          c.id,
          'error',
          'The last sync from the browser failed. Showing the last imported data.',
        );
      store.patchSyncState(c.id, { lastOutcome: outcome, startedAt: null });
      return true;
    },

    startGoogleAuth(userId, input) {
      if (!safeReturn(input.returnTo)) return { error: 'invalid_return_to' };
      const state = `gst_${randomBytes(18).toString('base64url')}`;
      deps.db
        .prepare('DELETE FROM ctx_oauth_states WHERE created_at < ?')
        .run(deps.now() - OAUTH_TTL_MS);
      deps.db
        .prepare(
          'INSERT INTO ctx_oauth_states(state, user_id, return_to, picked_json, created_at) VALUES(?,?,?,?,?)',
        )
        .run(state, userId, input.returnTo, JSON.stringify(input.pickedFileIds ?? []), deps.now());
      if (oauth)
        return {
          authorizationUrl: buildGoogleAuthorizationUrl(oauth, {
            state,
            verifier: verifierFor(state),
            loginHint: input.loginHint ?? null,
          }),
          mode: 'live',
        };
      // No client registered: the hub's labelled consent simulator (never claims a real Google connection).
      const u = new URL('/v1/connections/google/sim-consent', deps.config.baseUrl);
      u.searchParams.set('state', state);
      return { authorizationUrl: u.toString(), mode: 'fixture' };
    },

    async completeGoogleAuth({ state, code, error }) {
      const row = deps.db
        .prepare(
          'SELECT user_id, return_to, picked_json, created_at, consumed FROM ctx_oauth_states WHERE state=?',
        )
        .get(state) as
        | {
            user_id: string;
            return_to: string;
            picked_json: string;
            created_at: number;
            consumed: number;
          }
        | undefined;
      if (!row || row.consumed === 1 || deps.now() - row.created_at > OAUTH_TTL_MS)
        return { error: 'oauth_state_invalid' };
      deps.db.prepare('UPDATE ctx_oauth_states SET consumed=1 WHERE state=?').run(state);
      const mode: 'live' | 'fixture' = oauth ? 'live' : 'fixture';
      const fail = (msg: string) => ({
        redirect: webRedirect(row.return_to, 'error', mode, msg),
        userId: row.user_id,
      });
      if (error || !code)
        return fail(error === 'access_denied' ? 'access_denied' : 'authorization_failed');
      const picked = JSON.parse(row.picked_json) as string[];
      try {
        let secrets: TokenSecrets;
        let scopes: string[];
        let externalAccount: string;
        let expiresAt: number;
        if (oauth) {
          const tok = await exchangeGoogleCode(
            oauth,
            code,
            verifierFor(state),
            opts.fetch ?? fetch,
          );
          const who = await googleUserinfo(tok.access_token, opts.fetch ?? fetch);
          externalAccount = who.sub;
          scopes = grantedScopes(tok.scope, Object.values(GOOGLE_SCOPES));
          expiresAt = deps.now() + Math.max(30, tok.expires_in ?? 3600) * 1000;
          secrets = {
            accessToken: tok.access_token,
            ...(tok.refresh_token ? { refreshToken: tok.refresh_token } : {}),
            pickedFileIds: picked,
          };
        } else {
          if (code !== 'sim') return fail('authorization_failed');
          externalAccount = await connectors.google.accountId({
            accessToken: '',
            scopes: [],
          });
          scopes = [...Object.values(GOOGLE_SCOPES)];
          expiresAt = deps.now() + HOUR;
          secrets = {
            accessToken: `fixture-access-${randomBytes(8).toString('hex')}`,
            refreshToken: `fixture-refresh-${randomBytes(8).toString('hex')}`,
            pickedFileIds: picked,
          };
        }
        if (scopes.length === 0) return fail('no_scopes_granted');
        const accountHash = hashExternalAccount(
          deps.config.contactPepper,
          'google',
          externalAccount,
        );
        // Reconnecting the same Google account refreshes its grant (Nook upserts the account), never duplicates it.
        const prior = store
          .connectionsOf(row.user_id)
          .find(
            (c) =>
              c.provider === 'google' && c.accountHash === accountHash && c.status !== 'revoked',
          );
        const id = prior?.id ?? newId();
        const old = prior ? tokens.get(prior.id) : undefined;
        tokens.put(id, {
          ...secrets,
          // Google omits the refresh token on a repeat grant: keep the one we had (as Nook does).
          ...(!secrets.refreshToken && old?.refreshToken ? { refreshToken: old.refreshToken } : {}),
          pickedFileIds: picked.length ? picked : (old?.pickedFileIds ?? []),
        });
        store.upsertConnection({
          id,
          ownerId: row.user_id,
          provider: 'google',
          mode,
          variant: 'oauth',
          accountHash,
          scopes,
          status: 'live',
          degraded: false,
          statusNote: null,
          createdAt: prior?.createdAt ?? deps.now(),
          lastSyncAt: prior?.lastSyncAt ?? null,
          expiresAt,
        });
        store.patchSyncState(id, { retryAfter: null });
        await svc.sync(row.user_id, id);
        deps.log.info('context.google_connected', { connectionId: id, mode, scopes });
        return { redirect: webRedirect(row.return_to, 'connected', mode), userId: row.user_id };
      } catch (e) {
        // Google's error code only: never a token, code or response body.
        deps.log.warn('context.google_oauth_failed', {
          err: String((e as Error).message).slice(0, 80),
        });
        return fail('google_connection_failed');
      }
    },

    async tick(connectionId) {
      const c = store.connection(connectionId);
      if (!c) return;
      // A rate limit lifts by itself once its time has passed (the next sync clears the state).
      if (c.status === 'rate_limited') {
        const st = store.syncState(c.id);
        if (st.retryAfter !== null && st.retryAfter <= deps.now())
          store.setStatus(c.id, 'live', null);
        return;
      }
      if (c.status !== 'live' || c.expiresAt === null || c.expiresAt > deps.now() + 60_000) return;
      const s = tokens.get(c.id);
      const connector = c.provider === 'google' ? googleConnector(c) : undefined;
      if (s?.refreshToken && connector?.refresh) {
        try {
          const r = await connector.refresh(authFor(c, s) as GoogleAuth);
          tokens.put(c.id, { ...s, accessToken: r.accessToken });
          // The real expiry: never stretch a short-lived token to an hour (it would show "live" while Google 401s).
          store.patchConnection(c.id, { expiresAt: r.expiresAt ?? deps.now() + HOUR });
          return;
        } catch (e) {
          if (e instanceof ConnectorRateLimitError) {
            store.setStatus(
              c.id,
              'rate_limited',
              'Google asked us to slow down. Sync resumes automatically.',
            );
            store.patchSyncState(c.id, { retryAfter: deps.now() + e.retryAfterMs });
            return;
          }
          if (e instanceof ConnectorRevokedError) {
            // Google says the grant is gone: privacy first, the imported data is purged (docs/nook-parity.md, V3).
            store.revokeConnection(c.id, 'revoked', deps.now(), revokedNote(c.provider));
            tokens.delete(c.id);
            return;
          }
          if (!(e instanceof ConnectorExpiredError))
            deps.log.warn('context.refresh_failed', { connectionId: c.id });
        }
      }
      // Could not renew and the provider did not say "revoked": keep the data, flag it stale, ask to reconnect.
      store.setStatus(c.id, 'expired', expiredNote(c.provider));
    },

    async sync(userId, connectionId) {
      const c = store.connection(connectionId);
      if (!c || c.ownerId !== userId) return undefined;
      if (c.variant === 'session')
        return emptyReport(
          'skipped',
          'Canvas syncs from the Squad browser extension. Open Canvas in that browser and sync from there.',
        );
      await svc.tick(c.id);
      const fresh = store.connection(c.id)!;
      const s = tokens.get(c.id);
      if (!s && fresh.status !== 'revoked') {
        store.setStatus(c.id, 'error', 'Stored credential is missing. Reconnect.', true);
        return emptyReport('error');
      }
      const auth = authFor(fresh, s ?? {});
      const report =
        fresh.provider === 'canvas'
          ? await syncConnection(
              { store, now: deps.now },
              fresh,
              canvasConnector(fresh),
              auth as CanvasAuth,
            )
          : await syncConnection(
              {
                store,
                now: deps.now,
                onRefreshed: (r) => {
                  tokens.put(c.id, { ...tokens.get(c.id)!, accessToken: r.accessToken });
                  store.patchConnection(c.id, { expiresAt: r.expiresAt ?? deps.now() + HOUR });
                },
              },
              fresh,
              googleConnector(fresh),
              auth as GoogleAuth,
            );
      if (report.outcome === 'revoked') tokens.delete(c.id);
      deps.log.info('context.sync', {
        connectionId: c.id,
        provider: c.provider,
        outcome: report.outcome,
        pass: report.pass ?? null,
        added: report.added,
        removed: report.removed,
      });
      return report;
    },

    async disconnect(userId, connectionId) {
      const c = store.connection(connectionId);
      if (!c || c.ownerId !== userId) return undefined;
      const s = tokens.get(c.id);
      if (s && c.status !== 'revoked' && c.variant !== 'session') {
        try {
          const a = authFor(c, s);
          if (c.provider === 'canvas') await canvasConnector(c).revoke(a as CanvasAuth);
          else await googleConnector(c).revoke(a as GoogleAuth);
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
