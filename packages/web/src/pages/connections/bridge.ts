/** Web side of the Squad browser extension bridge (namespace `squad`, same shapes as the Nook bridge). */

const NS = 'squad';
export const MSG = {
  ready: `${NS}:extension-ready`,
  request: `${NS}:bridge-request`,
  response: `${NS}:bridge-response`,
  status: `${NS}:canvas-status`,
  authorize: `${NS}:canvas-authorize`,
  ping: `${NS}:ping`,
} as const;
export const EXT_ATTR = `data-${NS}-extension`;

export interface CanvasAccount {
  origin: string;
  canvasUserId: string;
  name: string | null;
}
export interface BridgeStatus {
  ok: boolean;
  accounts: CanvasAccount[];
  squadUserId: string | null;
  sync: { phase: 'syncing' | 'idle'; lastOutcome: string | null } | null;
  signInUrl?: string;
}
export interface BridgeResult {
  ok: boolean;
  error?: string;
}

export const extensionPresent = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.getAttribute(EXT_ATTR) === '1';

/** Calls back when the extension announces itself (or immediately if it already did). */
export function onExtensionReady(cb: () => void): () => void {
  if (extensionPresent()) cb();
  const h = () => cb();
  const m = (e: MessageEvent) => {
    if (
      (!e.source || e.source === window) &&
      (e.data as { type?: string } | null)?.type === MSG.ready
    )
      cb();
  };
  document.addEventListener(MSG.ready, h);
  window.addEventListener('message', m);
  return () => {
    document.removeEventListener(MSG.ready, h);
    window.removeEventListener('message', m);
  };
}

let seq = 0;
export function bridgeRequest<T>(
  message: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<T | null> {
  return new Promise((resolve) => {
    const requestId = `r${Date.now()}_${++seq}`;
    const done = (v: T | null) => {
      window.removeEventListener('message', on);
      clearTimeout(t);
      resolve(v);
    };
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; requestId?: string; response?: T } | null;
      if (
        (e.source && e.source !== window) ||
        d?.type !== MSG.response ||
        d.requestId !== requestId
      )
        return;
      done(d.response ?? null);
    };
    const t = setTimeout(() => done(null), timeoutMs);
    window.addEventListener('message', on);
    window.postMessage({ type: MSG.request, requestId, message }, window.location.origin);
  });
}

export const canvasStatus = () => bridgeRequest<BridgeStatus>({ type: MSG.status });
export const canvasAuthorize = (account: CanvasAccount, userId: string) =>
  bridgeRequest<BridgeResult>({
    type: MSG.authorize,
    canvasUserId: account.canvasUserId,
    origin: account.origin,
    userId,
  });
