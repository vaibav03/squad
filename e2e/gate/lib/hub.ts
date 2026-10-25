// Thin typed helpers over the hub HTTP API (own ports) and the web chat DOM.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { HUB, WEB } from './config';
import type { WorldUser } from './fakes/client';

export async function api(
  token: string | null,
  p: string,
  init: Omit<RequestInit, 'body'> & { json?: unknown; raw?: BodyInit } = {},
): Promise<{ status: number; text: string; json: any; headers: Headers }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined = init.raw;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const r = await fetch(`${HUB}${p}`, {
    ...init,
    headers,
    body,
    redirect: init.redirect ?? 'manual',
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, text, json, headers: r.headers };
}

/** The hub's ChatMessage wire shape (packages/core/src/chat.ts + chat-sync.ts). Only what the gate asserts on. */
export interface HMsg {
  id: string; // `m_<seq>`
  seq: number;
  ts: number;
  chatId: string;
  sender: { kind: 'student' | 'persona' | 'system'; id?: string; name: string; emoji?: string };
  text: string;
  private: boolean;
  citations: {
    file: string;
    page: number;
    label: string;
    source?: { kind: string; [k: string]: unknown };
  }[];
  card?: { type: string; [k: string]: unknown };
  demo: boolean;
  transport?: 'web' | 'imessage';
  externalId?: string;
  deliveryState?: {
    state: string;
    reason?: string;
    label: string;
    attempts?: number;
    degraded?: boolean;
  };
  senderLabel?: string;
  receivedLate?: boolean;
  [k: string]: unknown;
}

export async function history(token: string, chatId: string, limit = 100): Promise<HMsg[]> {
  const r = await api(
    token,
    `/v1/chat/history?chatId=${encodeURIComponent(chatId)}&limit=${limit}`,
  );
  return r.status === 200 ? (r.json.messages as HMsg[]) : [];
}

export const isBot = (m: HMsg) => m.sender.kind === 'persona';
/** Hub messages in the one shared thread order: message time, then hub sequence. */
export const threadOrder = (msgs: HMsg[]): HMsg[] =>
  [...msgs].sort((a, b) => a.ts - b.ts || a.seq - b.seq);

export async function waitFor<T>(
  fn: () => Promise<T | undefined | false>,
  ms = 30_000,
  every = 500,
): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return undefined;
}

export async function waitBot(
  token: string,
  chatId: string,
  pred: (m: HMsg) => boolean = () => true,
  after = 0,
  ms = 40_000,
): Promise<HMsg | undefined> {
  return waitFor(
    async () => (await history(token, chatId)).find((m) => isBot(m) && m.seq > after && pred(m)),
    ms,
  );
}

export const lastSeq = async (token: string, chatId: string) =>
  (await history(token, chatId)).reduce((n, m) => Math.max(n, m.seq), 0);

export interface WebActor {
  user: WorldUser;
  ctx: BrowserContext;
  page: Page;
  bodies: string[];
  consoleErrors: string[];
  texts: string[];
}

/** A browser signed in as a world user. The token goes into the same storage key the web app uses. */
export async function webActor(browser: Browser, user: WorldUser): Promise<WebActor> {
  const ctx = await browser.newContext({
    baseURL: WEB,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript(
    (u) => {
      try {
        localStorage.setItem(
          'squad.session',
          JSON.stringify({ userId: u.id, name: u.name, token: u.token, live: true }),
        );
        localStorage.setItem('squad.token', u.token);
      } catch {
        /* blocked */
      }
    },
    { id: user.id, name: user.name, token: user.token },
  );
  const page = await ctx.newPage();
  const a: WebActor = { user, ctx, page, bodies: [], consoleErrors: [], texts: [] };
  page.on('console', (m) => m.type() === 'error' && a.consoleErrors.push(m.text()));
  ctx.on('response', async (r) => {
    try {
      const ct = r.headers()['content-type'] ?? '';
      if (/json|text\/plain/.test(ct) && r.url().startsWith(HUB))
        a.bodies.push(`${r.url()}\n${await r.text()}`);
    } catch {
      /* body unavailable */
    }
  });
  return a;
}

export async function openGroupChat(a: WebActor, chatId: string): Promise<boolean> {
  await a.page.goto('/squad/chat');
  const ok = await a.page
    .locator('[data-testid="chat-list"],[data-testid="chat-thread"]')
    .first()
    .waitFor({ timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) return false;
  const row = a.page.getByTestId(`chat-row-${chatId}`);
  if (await row.count()) await row.click();
  return a.page
    .getByTestId('chat-composer-input')
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

/** The visible thread: one entry per rendered message, in DOM order. */
export async function domThread(page: Page) {
  return page.locator('[data-testid="chat-message"]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-message-id') ?? el.getAttribute('data-id') ?? '',
      senderId: el.getAttribute('data-sender-id') ?? '',
      text: (el as HTMLElement).innerText,
    })),
  );
}

export async function say(page: Page, text: string): Promise<void> {
  const box = page.getByTestId('chat-composer-input');
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}
