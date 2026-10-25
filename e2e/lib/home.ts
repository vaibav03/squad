import type { Browser, BrowserContext, Page } from '@playwright/test';
import { HUB, WEB } from './env';
import { apiLogin } from './helpers';

/** A brand-new account (email devCode) that owns a brand-new, empty squad: no trip, no courses, no phone. */
export async function newAccountToken(label: string): Promise<string> {
  const email = `${label}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const json = { 'content-type': 'application/json' };
  const start = await fetch(`${HUB}/v1/auth/start`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name: 'Fresh Tester', email }),
  });
  const s = (await start.json()) as { challengeId: string; devCode?: string };
  if (!start.ok || !s.devCode)
    throw new Error(`auth/start -> ${start.status} (needs HUB_DEV_LOGIN=1)`);
  const ver = await fetch(`${HUB}/v1/auth/verify`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ challengeId: s.challengeId, code: s.devCode }),
  });
  const v = (await ver.json()) as { token: string };
  if (!ver.ok) throw new Error(`auth/verify -> ${ver.status}`);
  const sq = await fetch(`${HUB}/v1/squads`, {
    method: 'POST',
    headers: { ...json, authorization: `Bearer ${v.token}` },
    body: JSON.stringify({ name: `Fresh Squad ${Date.now().toString(36).slice(-4)}` }),
  });
  if (!sq.ok) throw new Error(`squads create -> ${sq.status}`);
  return v.token;
}

export const seededToken = () => apiLogin('s_ana');

/** Records whether the word "offline" ever appeared in the visible page, at any instant (MutationObserver). */
export const WATCH_OFFLINE = () => {
  const w = window as unknown as { __offline: string[] };
  w.__offline = [];
  const scan = () => {
    const t = document.body?.innerText ?? '';
    const m = /offline/i.exec(t);
    if (m) w.__offline.push(t.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' '));
  };
  new MutationObserver(scan).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  document.addEventListener('DOMContentLoaded', scan);
};

export async function coldContext(
  browser: Browser,
  token: string,
  web: string = WEB,
): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    baseURL: web,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('squad.token', t);
    } catch {
      /* storage blocked */
    }
  }, token);
  await ctx.addInitScript(WATCH_OFFLINE);
  return ctx;
}

export type HubMode = 'up' | 'late' | 'slow' | 'flap';

/** Emulates the hub being late (unreachable for the first 2 s), slow (1.5 s per call) or flapping (every other call fails). */
export async function shapeHub(
  ctx: BrowserContext,
  mode: HubMode,
  hub: string = HUB,
): Promise<void> {
  if (mode === 'up') return;
  let t0 = 0; // the clock starts at the page's first hub request, not at context creation (vite cold start)
  let n = 0;
  await ctx.route(`${hub}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.continue();
    if (!t0) t0 = Date.now();
    if (mode === 'late' && Date.now() - t0 < 2000) return route.abort('connectionrefused');
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 1500));
    if (mode === 'flap' && n++ % 2 === 0) return route.abort('connectionrefused');
    return route.continue().catch(() => undefined);
  });
}

export const offlineSightings = (page: Page) =>
  page.evaluate(() => (window as unknown as { __offline?: string[] }).__offline ?? []);

/** The demo/review screenshots the reviewer opens: ~/Desktop/squad-demo/home-<name>.png */
export async function desktopShot(page: Page, name: string): Promise<string> {
  const { homedir } = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(homedir(), 'Desktop', 'squad-demo');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `home-${name}.png`);
  await page.screenshot({ path: file }).catch(() => undefined);
  return file;
}
