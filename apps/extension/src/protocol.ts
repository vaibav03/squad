import type { ExtensionAuth } from './auth';
import { CanvasAccessError, type CanvasClient } from './canvas';
import type { CanvasAccountSeen, StateStore, SyncOutcome, ExtState } from './state';
import { extensionMessageTypes } from './wire';

export function isExactHttpsOrigin(o: unknown): o is string {
  if (typeof o !== 'string') return false;
  try {
    return new URL(o).origin === o && o.startsWith('https://');
  } catch {
    return false;
  }
}

export interface SyncStatus {
  phase: 'syncing' | 'idle';
  progress: number | null;
  lastOutcome: SyncOutcome | null;
  lastFinishedAt: number | null;
}

export function deriveSync(s: ExtState): SyncStatus | null {
  if (!s.bound) return null;
  if (s.syncStartedAt !== null && s.syncFinishedAt === null)
    return {
      phase: 'syncing',
      progress: 0,
      lastOutcome: s.lastSyncOutcome,
      lastFinishedAt: s.lastSyncFinishedAt,
    };
  return {
    phase: 'idle',
    progress: null,
    lastOutcome: s.lastSyncOutcome,
    lastFinishedAt: s.lastSyncFinishedAt,
  };
}

export interface HandlerDeps {
  namespace: string;
  hubBase: string;
  store: StateStore;
  auth: ExtensionAuth;
  canvas: Pick<CanvasClient, 'collect'>;
  fetch: typeof fetch;
  openSignIn: () => Promise<void> | void;
  now?: () => number;
  log?: (...a: unknown[]) => void;
}
export interface HandlerCtx {
  senderOrigin: string | null;
}

type Reply = Record<string, unknown>;
const fail = (error: string, extra: Reply = {}): Reply => ({ ok: false, error, ...extra });
const REGISTRATION_ERRORS = new Set([
  'canvas_account_already_bound',
  'canvas_account_conflict',
  'canvas_origin_not_allowed',
]);

export function createHandler(deps: HandlerDeps) {
  const T = extensionMessageTypes(deps.namespace);
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => undefined);
  const hub = deps.hubBase.replace(/\/+$/, '');

  async function post(path: string, token: string, body: unknown): Promise<Response> {
    return deps.fetch(`${hub}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }
  async function errCode(res: Response): Promise<{ code?: string; ownerHint?: string | null }> {
    try {
      const b = (await res.json()) as { error?: { code?: string; owner_hint?: string | null } };
      return { code: b.error?.code, ownerHint: b.error?.owner_hint ?? null };
    } catch {
      return {};
    }
  }
  async function signedInUserId(): Promise<string | null> {
    const token = await deps.auth.getToken();
    if (!token) return null;
    return (await deps.store.get()).session?.userId ?? null;
  }

  async function canvasStatus(ctx: HandlerCtx): Promise<Reply> {
    const userId = await signedInUserId();
    const s = await deps.store.get();
    const reply: Reply = {
      ok: true,
      accounts: s.accounts.filter(
        (a: CanvasAccountSeen) =>
          isExactHttpsOrigin(a.origin) && typeof a.canvasUserId === 'string',
      ),
      squadUserId: userId,
      sync: deriveSync(s),
    };
    if (ctx.senderOrigin) reply.signInUrl = `${ctx.senderOrigin}/settings`;
    return reply;
  }

  async function runSync(
    token: string,
    connectionId: string,
    account: CanvasAccountSeen,
  ): Promise<SyncOutcome> {
    await deps.store.patch({ syncStartedAt: now(), syncFinishedAt: null });
    let outcome: SyncOutcome = 'ok';
    try {
      const payload = await deps.canvas.collect(account);
      const res = await post(
        `/v1/connections/${encodeURIComponent(connectionId)}/canvas-sync`,
        token,
        payload,
      );
      if (res.status === 401) await deps.auth.clear();
      if (!res.ok)
        outcome = res.status === 429 ? 'rate_limited' : res.status === 401 ? 'expired' : 'error';
    } catch (e) {
      outcome = e instanceof CanvasAccessError ? e.kind : 'error';
      if (outcome === 'error') log('[squad-ext] sync failed');
      // Tell the hub what Canvas said so the connection shows the honest state (expired / rate_limited) everywhere.
      await post(`/v1/connections/${encodeURIComponent(connectionId)}/canvas-report`, token, {
        outcome,
      }).catch(() => undefined);
    }
    const t = now();
    await deps.store.patch({ syncFinishedAt: t, lastSyncOutcome: outcome, lastSyncFinishedAt: t });
    return outcome;
  }

  async function canvasAuthorize(msg: Reply, ctx: HandlerCtx): Promise<Reply> {
    const { canvasUserId, origin, userId } = msg as {
      canvasUserId?: unknown;
      origin?: unknown;
      userId?: unknown;
    };
    if (!isExactHttpsOrigin(origin)) return fail('canvas_origin_not_allowed');
    if (typeof canvasUserId !== 'string' || typeof userId !== 'string' || !userId)
      return fail('canvas_session_changed');
    const signedIn = await signedInUserId();
    if (!signedIn)
      return fail('squad_not_signed_in', {
        squadUserId: null,
        ...(ctx.senderOrigin ? { signInUrl: `${ctx.senderOrigin}/settings` } : {}),
      });
    if (signedIn !== userId) return fail('squad_account_mismatch', { squadUserId: signedIn });
    const s = await deps.store.get();
    if (s.allowedOrigins.length > 0 && !s.allowedOrigins.includes(origin))
      return fail('canvas_origin_not_allowed');
    const account = s.accounts.find((a) => a.canvasUserId === canvasUserId && a.origin === origin);
    if (!account) return fail('canvas_session_changed');
    const token = await deps.auth.getToken();
    if (!token) return fail('squad_not_signed_in', { squadUserId: null });

    let res: Response;
    try {
      res = await post('/v1/connections/canvas/register', token, {
        canvas_user_id: account.canvasUserId,
        canvas_origin: account.origin,
        name: account.name ?? null,
        primary_email: account.primary_email ?? null,
      });
    } catch {
      log('[squad-ext] registration request failed');
      return fail('canvas_registration_failed');
    }
    if (res.status === 401) {
      await deps.auth.clear();
      return fail('squad_not_signed_in', { squadUserId: null });
    }
    if (!res.ok) {
      const { code, ownerHint } = await errCode(res);
      if (code && REGISTRATION_ERRORS.has(code))
        return fail(code, code === 'canvas_account_already_bound' ? { ownerHint } : {});
      log('[squad-ext] registration rejected', res.status, code);
      return fail('canvas_registration_failed');
    }
    const body = (await res.json().catch(() => ({}))) as { connection?: { id?: string } };
    const connectionId = body.connection?.id;
    if (!connectionId) return fail('canvas_registration_failed');
    await deps.store.patch({
      bound: { canvasUserId, origin, userId: signedIn, connectionId, boundAt: now() },
    });
    const outcome = await runSync(token, connectionId, account);
    return {
      ok: true,
      squadUserId: signedIn,
      sync: deriveSync(await deps.store.get()),
      lastOutcome: outcome,
    };
  }

  return async function handle(msg: unknown, ctx: HandlerCtx): Promise<Reply | null> {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as Reply;
    switch (m.type) {
      case T.ping:
        return { ok: true };
      case T.canvasStatus:
        return canvasStatus(ctx);
      case T.canvasAuthorize:
        return canvasAuthorize(m, ctx);
      case T.canvasOpenSignIn:
        await deps.openSignIn();
        return { ok: true };
      default:
        return null;
    }
  };
}
