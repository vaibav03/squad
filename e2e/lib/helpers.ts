import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, LIVE, SHOTS, WEB, type StudentId } from './env';

export const NAMES: Record<string, string> = {
  s_ana: 'Ana',
  s_ben: 'Ben',
  s_chi: 'Chi',
  s_dev: 'Dev',
};
export const WEB_ID = (id: string) => id.replace(/^s_/, '');

export interface Actor {
  id: StudentId;
  ctx: BrowserContext;
  page: Page;
  token: string;
  bodies: string[]; // JSON/text responses from the hub (privacy scans)
  assets: string[]; // js/css/html served by the web host (secret scans)
  consoleErrors: string[];
  pageErrors: string[];
}

export async function apiLogin(id: string): Promise<string> {
  const r = await fetch(`${HUB}/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: id }),
  });
  if (!r.ok) throw new Error(`dev-login ${id} -> ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}

export async function api(
  token: string | null,
  p: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  return fetch(`${HUB}${p}`, { ...init, headers, body });
}

/** New isolated browser context signed in (through the real dev-login route) as one student. */
export async function actor(
  browser: Browser,
  id: StudentId,
  opts: {
    viewport?: { width: number; height: number };
    reducedMotion?: 'reduce' | 'no-preference';
  } = {},
): Promise<Actor> {
  const token = await apiLogin(id);
  const ctx = await browser.newContext({
    baseURL: WEB,
    viewport: opts.viewport ?? { width: 1280, height: 800 },
    reducedMotion: opts.reducedMotion ?? 'reduce',
    isMobile: !!opts.viewport && opts.viewport.width < 500,
    hasTouch: !!opts.viewport && opts.viewport.width < 500,
  });
  const session = {
    userId: id,
    name: NAMES[id],
    token,
    avatarUrl: `/avatars/${WEB_ID(id)}.png`,
    live: true,
  };
  await ctx.addInitScript((s) => {
    try {
      if (!localStorage.getItem('squad.token')) localStorage.setItem('squad.token', s.token);
      if (!localStorage.getItem('squad.session'))
        localStorage.setItem('squad.session', JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, session);
  const page = await ctx.newPage();
  const a: Actor = {
    id,
    ctx,
    page,
    token,
    bodies: [],
    assets: [],
    consoleErrors: [],
    pageErrors: [],
  };
  page.on('console', (m) => {
    if (m.type() === 'error') a.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => a.pageErrors.push(e.message));
  ctx.on('response', async (r) => {
    try {
      const ct = r.headers()['content-type'] ?? '';
      if (ct.includes('event-stream')) return;
      if (/json|text\/plain/.test(ct) && r.url().startsWith(HUB))
        a.bodies.push(`${r.url()}\n${await r.text()}`);
      else if (/javascript|css|html/.test(ct)) a.assets.push(`${r.url()}\n${await r.text()}`);
    } catch {
      /* body unavailable (redirect, aborted) */
    }
  });
  return a;
}

export async function shot(page: Page, journey: string, step: string): Promise<string> {
  const dir = path.join(SHOTS, journey);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${step.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
  return file;
}
/** Kept for the specs that call it; shots are named by journey and step, so there is nothing to reset. */
export const resetShots = (): void => undefined;

/** Marks the running test `blocked` (feature on an unmerged branch) and skips it. */
export function blocked(reason: string): never {
  test.info().annotations.push({ type: 'blocked', description: reason });
  test.skip(true, `blocked: ${reason}`);
  throw new Error('unreachable');
}
export function note(text: string) {
  test.info().annotations.push({ type: 'note', description: text });
}

export async function hubHas(route: string, token?: string): Promise<boolean> {
  const r = await api(token ?? (await apiLogin('s_ana')), route);
  return r.status !== 404;
}
export async function chatMerged(): Promise<boolean> {
  return hubHas('/v1/chat/chats');
}

export interface LlmStatus {
  llm: string;
  demo: boolean;
  reason?: string;
  notice?: string;
  tts: string;
}
export async function status(): Promise<LlmStatus> {
  return (await (await fetch(`${HUB}/v1/status`)).json()) as LlmStatus;
}

/** LIVE=1 guard: skip with a clear message when Gemini cannot answer. */
export async function liveGuard(): Promise<void> {
  if (!LIVE) return;
  const s = await status();
  if (s.demo) {
    test.info().annotations.push({
      type: 'skipped-live',
      description: `LIVE=1 but /v1/status says ${s.reason ?? 'fake'}`,
    });
    test.skip(true, `LIVE skipped: llm unavailable (${s.reason ?? 'fake'})`);
  }
}

/** Read an SSE stream for `ms` from a viewer; returns raw text. */
export async function collectSse(
  p: string,
  token: string,
  ms = 2500,
  headers: Record<string, string> = {},
): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  let out = '';
  try {
    const sep = p.includes('?') ? '&' : '?';
    const r = await fetch(`${HUB}${p}${sep}st=${encodeURIComponent(token)}`, {
      signal: ctl.signal,
      headers,
    });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
  } catch {
    /* aborted on purpose */
  }
  clearTimeout(t);
  return out;
}

export function sseEvents(raw: string): { id?: string; event: string; data: string }[] {
  return raw
    .split('\n\n')
    .map((blk) => {
      const o: { id?: string; event: string; data: string } = { event: 'message', data: '' };
      for (const line of blk.split('\n')) {
        if (line.startsWith('id:')) o.id = line.slice(3).trim();
        else if (line.startsWith('event:')) o.event = line.slice(6).trim();
        else if (line.startsWith('data:')) o.data += line.slice(5).trim();
      }
      return o;
    })
    .filter((e) => e.data);
}

export const FAIL_PATTERNS = {
  secrets: [
    /AIza[0-9A-Za-z_-]{20,}/,
    /sk_[0-9a-f]{20,}/,
    /xi-api-key/i,
    /GEMINI_API_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/,
    /ELEVENLABS_API_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{12,}/,
    /INTERNAL_EVENTS_SECRET\s*[=:]\s*["']?[A-Za-z0-9_-]{8,}/,
  ],
};
export { test, expect };
