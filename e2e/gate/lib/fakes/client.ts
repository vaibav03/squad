/* eslint-disable @typescript-eslint/no-explicit-any -- the gate reads untyped hub JSON */
// Test-side controls for the fakes and the gate hub control server.
import { CANVAS, CTL, GOOGLE } from '../config';
import { canvasFeedUrl } from './fake-canvas';
import { CANVAS_PORT } from '../config';
import { HUB_CTL, type UpstreamBehavior } from '../contract';

async function post(base: string, p: string, body: unknown = {}): Promise<any> {
  const r = await fetch(`${base}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => ({}));
}
async function get(base: string, p: string): Promise<any> {
  return (await fetch(`${base}${p}`)).json();
}

/**
 * Upstream controls for the REAL hub wiring: the hub's fixture connectors are in-process, so their behaviour is flipped
 * through the gate-hub control server (HUB_CTL). Resolves { ok:false, status } (never throws) when the endpoint is not
 * wired yet, so callers can report that honestly instead of crashing.
 */
export const hubCtx = {
  async call(p: string, body: unknown = {}): Promise<{ ok: boolean; status: number; body: any }> {
    try {
      const r = await fetch(`${CTL}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    } catch {
      return { ok: false, status: 0, body: {} };
    }
  },
  upstream: (provider: 'canvas' | 'google', behavior: UpstreamBehavior, refreshFails?: boolean) =>
    hubCtx.call(HUB_CTL.upstream, {
      provider,
      behavior,
      ...(refreshFails === undefined ? {} : { refreshFails }),
    }),
  expireClock: (provider?: 'canvas' | 'google') =>
    hubCtx.call(HUB_CTL.expireClock, provider ? { provider } : {}),
  reset: () => hubCtx.call(HUB_CTL.reset),
};

// The HTTP fakes below (8940/8941) are NOT reachable from the hub (it has no base-URL override). They stay for a hub that
// grows one and for the real-integration smoke path; the steps use `hubCtx` for upstream behaviour.
export const canvas = {
  feedUrl: () => canvasFeedUrl(CANVAS_PORT),
  mode: (mode: 'ok' | '404' | '410' | 'moved' | 'big') => post(CANVAS, '/_ctl/mode', { mode }),
  tokenValid: (valid: boolean) => post(CANVAS, '/_ctl/token', { valid }),
  reset: () => post(CANVAS, '/_ctl/reset'),
  requests: async (): Promise<{ method: string; path: string }[]> =>
    (await get(CANVAS, '/_ctl/requests')).requests,
};

export const google = {
  revoke: () => post(GOOGLE, '/_ctl/revoke'),
  expire: () => post(GOOGLE, '/_ctl/expire'),
  ttl: (seconds: number) => post(GOOGLE, '/_ctl/ttl', { seconds }),
  overGrant: (on: boolean) => post(GOOGLE, '/_ctl/over-grant', { on }),
  failRefresh: (n: number) => post(GOOGLE, '/_ctl/fail-refresh', { n }),
  pick: (ids: string[]) => post(GOOGLE, '/_ctl/pick', { ids }),
  reset: () => post(GOOGLE, '/_ctl/reset'),
  grants: async (): Promise<{ id: string; scopes: string[]; revoked: boolean }[]> =>
    (await get(GOOGLE, '/_ctl/grants')).grants,
  requests: async (): Promise<{ method: string; path: string; scope?: string; status: number }[]> =>
    (await get(GOOGLE, '/_ctl/requests')).requests,
};

export interface WorldUser {
  id: string;
  token: string;
  phone: string;
  name: string;
}
export interface World {
  index: number;
  users: { rhea: WorldUser; ben: WorldUser; cy: WorldUser; dan?: WorldUser };
  squadA: { id: string; invite: string; chat: string; chatId: string };
  squadB?: { id: string; invite: string; chat: string; chatId: string };
}
export interface Sent {
  to: string;
  text?: string;
}
export interface Receipt {
  to: string;
  text: string;
  ok: boolean;
  error?: string;
}

export const im = {
  world: (opts: { b?: boolean } = {}): Promise<World> => post(CTL, '/ctl/world', opts),
  say: (chat: string, from: string, text: string, guid?: string) =>
    post(CTL, '/ctl/im/say', { chat, from, text, ...(guid ? { guid } : {}) }) as Promise<{
      last?: string;
    }>,
  dm: (from: string, text: string) => post(CTL, '/ctl/im/dm', { from, text }),
  duplicate: (guid: string, times = 1) => post(CTL, '/ctl/im/duplicate', { guid, times }),
  outOfOrder: (messages: { chatId: string; sender: string; text: string }[]) =>
    post(CTL, '/ctl/im/out-of-order', { messages }) as Promise<{ guids: { guid: string }[] }>,
  drop: () => post(CTL, '/ctl/im/drop'),
  backfill: (): Promise<{ delivered: number }> => post(CTL, '/ctl/im/backfill'),
  failNext: (n: number) => post(CTL, '/ctl/im/fail-next', { n }),
  delay: (ms: number) => post(CTL, '/ctl/im/delay', { ms }),
  reset: () => post(CTL, '/ctl/im/reset'),
  sent: (to?: string): Promise<{ sent: Sent[]; receipts: Receipt[]; gap: number }> =>
    get(CTL, `/ctl/im/sent${to ? `?to=${encodeURIComponent(to)}` : ''}`),
  log: async (): Promise<{ id: string; chatId: string; sender: string; text: string }[]> =>
    (await get(CTL, '/ctl/im/log')).log,
  dbDump: async (): Promise<string> => JSON.stringify(await get(CTL, '/ctl/db/dump')),
  health: () => get(CTL, '/ctl/health'),
};
