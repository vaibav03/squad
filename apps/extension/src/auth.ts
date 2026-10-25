import type { StateStore, ExtSession } from './state';

export interface ExtensionAuth {
  /** Exchange a one-time pairing code (issued by the signed-in Squad web app) for a scoped extension bearer. */
  pair(code: string): Promise<ExtSession>;
  /** The bearer, or null when absent / expired / rejected by the hub (a 401 clears the session). */
  getToken(): Promise<string | null>;
  /** Called by callers on a hub 401. */
  clear(): Promise<void>;
  signOut(): Promise<void>;
}

async function readError(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { error?: { code?: string } };
    return b.error?.code ?? `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
}

export function createExtensionAuth(
  hubBase: string,
  store: StateStore,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  now: () => number = () => Date.now(),
): ExtensionAuth {
  const base = hubBase.replace(/\/+$/, '');
  return {
    async pair(code) {
      const res = await fetchImpl(`${base}/v1/connections/extension/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const b = (await res.json()) as { token: string; userId: string; expiresAt: number };
      const session: ExtSession = { token: b.token, userId: b.userId, expiresAt: b.expiresAt };
      await store.patch({ session });
      return session;
    },
    async getToken() {
      const { session } = await store.get();
      if (!session) return null;
      if (session.expiresAt <= now()) {
        await store.patch({ session: null });
        return null;
      }
      return session.token;
    },
    async clear() {
      await store.patch({ session: null, bound: null });
    },
    async signOut() {
      await store.patch({ session: null, bound: null });
    },
  };
}
