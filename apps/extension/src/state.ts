export type SyncOutcome = 'ok' | 'expired' | 'rate_limited' | 'error';

export interface CanvasAccountSeen {
  origin: string;
  canvasUserId: string;
  name: string | null;
  primary_email: string | null;
}
/** Scoped extension bearer from the pairing exchange. Never leaves chrome.storage.local except as an Authorization header to the hub. */
export interface ExtSession {
  token: string;
  userId: string;
  expiresAt: number;
}
export interface BoundAccount {
  canvasUserId: string;
  origin: string;
  userId: string;
  connectionId: string;
  boundAt: number;
}
export interface ExtState {
  session: ExtSession | null;
  /** Canvas logins the content script / probe saw in this browser. */
  accounts: CanvasAccountSeen[];
  /** Optional allow-list of exact https origins. Empty means any exact https origin. */
  allowedOrigins: string[];
  bound: BoundAccount | null;
  syncStartedAt: number | null;
  syncFinishedAt: number | null;
  lastSyncOutcome: SyncOutcome | null;
  lastSyncFinishedAt: number | null;
}
export const DEFAULT_STATE: ExtState = {
  session: null,
  accounts: [],
  allowedOrigins: [],
  bound: null,
  syncStartedAt: null,
  syncFinishedAt: null,
  lastSyncOutcome: null,
  lastSyncFinishedAt: null,
};
export interface StateStore {
  get(): Promise<ExtState>;
  patch(p: Partial<ExtState>): Promise<ExtState>;
}

const KEY = 'squad.ext.state';
export function chromeStateStore(): StateStore {
  const get = async (): Promise<ExtState> => {
    try {
      const r = await chrome.storage.local.get(KEY);
      return { ...DEFAULT_STATE, ...((r?.[KEY] as Partial<ExtState>) ?? {}) };
    } catch {
      return { ...DEFAULT_STATE };
    }
  };
  return {
    get,
    async patch(p) {
      const next = { ...(await get()), ...p };
      await chrome.storage.local.set({ [KEY]: next });
      return next;
    },
  };
}
export function memoryStateStore(init: Partial<ExtState> = {}): StateStore {
  let s: ExtState = { ...DEFAULT_STATE, ...init };
  return {
    get: async () => ({ ...s }),
    patch: async (p) => (s = { ...s, ...p }),
  };
}
