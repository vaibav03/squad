import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import {
  ConnectorAuthError,
  ConnectorExpiredError,
  ConnectorRateLimitError,
  ConnectorRevokedError,
  GOOGLE_SCOPES,
  createFakeGoogleConnector,
  type Connector,
  type GoogleAuth,
} from './connectors';
import { hashExternalAccount } from './ids';
import { createContextStore } from './store';
import { revokedNote, syncConnection } from './sync';
import type { ContextConnection } from './types';

const T0 = Date.UTC(2026, 9, 25);
const auth: GoogleAuth = {
  accessToken: 'AT-old',
  refreshToken: 'RT-1',
  scopes: Object.values(GOOGLE_SCOPES),
  pickedFileIds: ['d1', 'd2'],
};
const conn: ContextConnection = {
  id: 'conn_g',
  ownerId: 's_ana',
  provider: 'google',
  mode: 'fixture',
  variant: 'oauth',
  accountHash: hashExternalAccount('pepper', 'google', 'acct'),
  scopes: auth.scopes,
  status: 'live',
  degraded: false,
  statusNote: null,
  createdAt: T0,
  lastSyncAt: null,
  expiresAt: null,
};

/** The fake Google connector with a token that Google stopped accepting: every call 401s until the access token changes. */
function dyingToken(refresh: Connector<GoogleAuth>['refresh']) {
  const inner = createFakeGoogleConnector();
  const calls: string[] = [];
  const dead = (a: GoogleAuth) => a.accessToken === 'AT-old';
  const c: Connector<GoogleAuth> = {
    ...inner,
    async status(a) {
      calls.push('status');
      return dead(a)
        ? { state: 'revoked', note: 'Google no longer accepts this grant.' }
        : inner.status(a);
    },
    async listItems(a, id, o) {
      calls.push('list');
      if (dead(a)) throw new ConnectorAuthError(401);
      return inner.listItems(a, id, o);
    },
    async refresh(a) {
      calls.push('refresh');
      return refresh!(a);
    },
  };
  return { c, calls };
}

function kit() {
  const store = createContextStore(openMemoryDb());
  store.upsertConnection(conn);
  const refreshedWith: string[] = [];
  const deps = {
    store,
    now: () => T0,
    onRefreshed: (r: { accessToken: string }) => void refreshedWith.push(r.accessToken),
  };
  return { store, deps, refreshedWith };
}

describe('401 on sync: refresh once, retry (V4)', () => {
  it('401 -> refresh -> ok: no user-visible failure, state live, the new token is handed back once', async () => {
    const { store, deps, refreshedWith } = kit();
    const { c, calls } = dyingToken(async () => ({ accessToken: 'AT-new', expiresAt: T0 + 3.6e6 }));
    const r = await syncConnection(deps, conn, c, auth);
    expect(r.outcome).toBe('ok');
    expect(calls.filter((x) => x === 'refresh')).toHaveLength(1);
    expect(refreshedWith).toEqual(['AT-new']);
    expect(store.connection(conn.id)).toMatchObject({ status: 'live', degraded: false });
    expect(store.sourcesOfConnection(conn.id).length).toBeGreaterThan(0);
  });

  it('401 -> refresh refused (not invalid_grant) -> expired, data KEPT, sync stops, never live', async () => {
    const { store, deps } = kit();
    const ok = dyingToken(async () => ({ accessToken: 'AT-new', expiresAt: null }));
    await syncConnection(deps, conn, ok.c, { ...auth, accessToken: 'AT-new' });
    const n = store.sourcesOfConnection(conn.id).length;
    expect(n).toBeGreaterThan(0);
    const { c, calls } = dyingToken(async () => {
      throw new ConnectorExpiredError('google_refresh_failed:invalid_client');
    });
    const r = await syncConnection(deps, conn, c, auth);
    expect(r.outcome).toBe('expired');
    expect(calls.filter((x) => x === 'refresh')).toHaveLength(1);
    expect(store.connection(conn.id)!.status).toBe('expired');
    expect(store.connection(conn.id)!.statusNote).toMatch(/Reconnect/);
    expect(store.sourcesOfConnection(conn.id)).toHaveLength(n); // kept, not purged
    // sync is stopped: no further upstream calls while expired
    const before = calls.length;
    expect((await syncConnection(deps, conn, c, auth)).outcome).toBe('expired');
    expect(calls).toHaveLength(before);
  });

  it('401 -> refresh answers invalid_grant -> revoked, data purged, honest reconnect message', async () => {
    const { store, deps } = kit();
    const ok = dyingToken(async () => ({ accessToken: 'AT-new', expiresAt: null }));
    await syncConnection(deps, conn, ok.c, { ...auth, accessToken: 'AT-new' });
    expect(store.sourcesOfConnection(conn.id).length).toBeGreaterThan(0);
    const { c } = dyingToken(async () => {
      throw new ConnectorRevokedError('invalid_grant');
    });
    const r = await syncConnection(deps, conn, c, auth);
    expect(r.outcome).toBe('revoked');
    expect(store.connection(conn.id)!.status).toBe('revoked');
    expect(store.connection(conn.id)!.statusNote).toBe(
      'Google access was revoked. Imported data was removed. Reconnect to import again.',
    );
    expect(revokedNote('google')).toBe(store.connection(conn.id)!.statusNote);
    expect(store.sourcesOfConnection(conn.id)).toHaveLength(0);
  });

  it('a 401 that persists after a successful refresh is expired (kept), and refresh is never attempted twice', async () => {
    const { store, deps } = kit();
    const { c, calls } = dyingToken(async () => ({ accessToken: 'AT-old', expiresAt: null }));
    const r = await syncConnection(deps, conn, c, auth);
    expect(r.outcome).toBe('expired');
    expect(calls.filter((x) => x === 'refresh')).toHaveLength(1);
    expect(store.connection(conn.id)!.status).toBe('expired');
  });

  it('rate_limited is unaffected: no refresh, state rate_limited, retry time recorded', async () => {
    const { store, deps } = kit();
    const inner = createFakeGoogleConnector();
    let refreshes = 0;
    const c: Connector<GoogleAuth> = {
      ...inner,
      async status() {
        throw new ConnectorRateLimitError(30_000);
      },
      async refresh() {
        refreshes++;
        return { accessToken: 'x', expiresAt: null };
      },
    };
    const r = await syncConnection(deps, conn, c, auth);
    expect(r.outcome).toBe('rate_limited');
    expect(refreshes).toBe(0);
    expect(store.connection(conn.id)!.status).toBe('rate_limited');
    expect(store.syncState(conn.id).retryAfter).toBe(T0 + 30_000);
  });

  it('a refresh that is itself rate limited reports rate_limited, not expired', async () => {
    const { store, deps } = kit();
    const { c } = dyingToken(async () => {
      throw new ConnectorRateLimitError(20_000);
    });
    expect((await syncConnection(deps, conn, c, auth)).outcome).toBe('rate_limited');
    expect(store.connection(conn.id)!.status).toBe('rate_limited');
  });
});
