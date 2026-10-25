import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  AccountUser,
  AuthStartBody,
  AuthStartResponse,
  SessionResponse,
  SquadSummary,
} from '@squad/core';
import type { AccountsClient, Me } from './client';
import { isApiError } from './errors';
import { rememberName } from '@squad/village/inspector';
import { loadToken, saveToken } from './storage';

export type AccountStatus = 'loading' | 'signed-out' | 'signed-in' | 'offline';

export interface AccountValue {
  status: AccountStatus;
  user: AccountUser | null;
  squads: SquadSummary[];
  activeSquadId: string | null;
  activeSquad: SquadSummary | null;
  /** Bearer fallback so pages that read `useSquadConfig().token` keep working. Never log it. */
  token: string | null;
  client: AccountsClient;
  /** null until probed; true when the hub has developer sign-in on. */
  devLogin: boolean | null;
  online: boolean;
  start(body: AuthStartBody): Promise<AuthStartResponse>;
  resend(challengeId: string): Promise<AuthStartResponse>;
  verify(challengeId: string, code: string): Promise<SessionResponse>;
  logout(): Promise<void>;
  switchSquad(id: string): Promise<void>;
  refresh(): Promise<void>;
  /** Adopts a bearer token (developer sign-in) and loads the account behind it. */
  adoptToken(token: string): Promise<void>;
  /** Runs after the account vanishes on the server (delete account). */
  clear(): void;
}

const Ctx = createContext<AccountValue | null>(null);

interface Snapshot {
  user: AccountUser | null;
  squads: SquadSummary[];
  activeSquadId: string | null;
}
const EMPTY: Snapshot = { user: null, squads: [], activeSquadId: null };

export function AuthProvider({
  client,
  children,
}: {
  client: AccountsClient;
  children: ReactNode;
}) {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [status, setStatus] = useState<AccountStatus>('loading');
  const [token, setTokenState] = useState<string | null>(() => loadToken());
  const [devLogin, setDevLogin] = useState<boolean | null>(null);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    if (snap.user) rememberName(snap.user.id, snap.user.name, true);
  }, [snap.user]);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setToken = useCallback(
    (t: string | null) => {
      saveToken(t);
      client.setToken(t);
      setTokenState(t);
    },
    [client],
  );

  const apply = useCallback((s: Snapshot) => {
    if (!alive.current) return;
    setSnap(s);
    setStatus('signed-in');
  }, []);
  const applySession = useCallback(
    (r: SessionResponse) => {
      setToken(r.token);
      apply({ user: r.user, squads: r.squads, activeSquadId: r.activeSquadId ?? null });
    },
    [apply, setToken],
  );
  const signedOut = useCallback(() => {
    setToken(null);
    if (!alive.current) return;
    setSnap(EMPTY);
    setStatus('signed-out');
  }, [setToken]);
  const failed = useCallback(
    (e: unknown) => {
      if (isApiError(e, 'unauthorized')) signedOut();
      else if (alive.current) setStatus('offline');
    },
    [signedOut],
  );

  /** Cookie first: GET /v1/me, then a rotating refresh when we have no bearer or the bearer is stale. */
  const load = useCallback(async () => {
    client.setToken(loadToken());
    let me: Me | null = null;
    if (loadToken()) {
      try {
        me = await client.me();
      } catch (e) {
        if (!isApiError(e, 'unauthorized')) return failed(e);
        saveToken(null);
        client.setToken(null);
      }
    }
    try {
      if (me && loadToken()) {
        apply(me);
        return;
      }
      applySession(await client.refreshSession());
    } catch (e) {
      failed(e);
    }
  }, [apply, applySession, client, failed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (status !== 'signed-out' || client.mock || devLogin !== null) return;
    let live = true;
    void client.devLoginAvailable().then((ok) => {
      if (live) setDevLogin(ok);
    });
    return () => {
      live = false;
    };
  }, [status, client, devLogin]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // Coming back online while we were offline: try once more without being asked.
  useEffect(() => {
    if (online && status === 'offline') void load();
  }, [online, status, load]);

  const refresh = useCallback(async () => {
    try {
      apply(await client.me());
    } catch (e) {
      failed(e);
      throw e;
    }
  }, [apply, client, failed]);

  const value = useMemo<AccountValue>(
    () => ({
      status,
      user: snap.user,
      squads: snap.squads,
      activeSquadId: snap.activeSquadId,
      activeSquad: snap.squads.find((s) => s.id === snap.activeSquadId) ?? null,
      token,
      client,
      devLogin,
      online,
      start: (b) => client.authStart(b),
      resend: (id) => client.authResend(id),
      async verify(challengeId, code) {
        const r = await client.authVerify(challengeId, code);
        applySession(r);
        return r;
      },
      async logout() {
        try {
          await client.logout();
        } catch {
          /* offline: still forget the session on this device */
        }
        signedOut();
      },
      async switchSquad(id) {
        await client.activateSquad(id);
        await refresh();
      },
      refresh,
      async adoptToken(t) {
        setToken(t);
        try {
          apply(await client.me());
        } catch (e) {
          setToken(null);
          throw e;
        }
      },
      clear: signedOut,
    }),
    [
      status,
      snap,
      token,
      client,
      devLogin,
      online,
      applySession,
      signedOut,
      refresh,
      setToken,
      apply,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccount must be used inside <AuthProvider>.');
  return v;
}

/** Same as useAccount but returns null outside a provider (stories, tests). */
export function useMaybeAccount(): AccountValue | null {
  return useContext(Ctx);
}
