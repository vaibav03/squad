// Test-side controls for the fakes and the gate hub control server.
import { CANVAS, CTL, GOOGLE } from '../config';
import { canvasFeedUrl } from './fake-canvas';
import { CANVAS_PORT } from '../config';

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

// The hub runs its real connectors against these servers (fetch seam in gate-hub.ts); these are the upstream controls.
export const canvas = {
  feedUrl: () => canvasFeedUrl(CANVAS_PORT),
  mode: (mode: 'ok' | '404' | '410' | 'moved' | 'big' | 'rate_limited') =>
    post(CANVAS, '/_ctl/mode', { mode }),
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
