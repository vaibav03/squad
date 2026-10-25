#!/usr/bin/env node
/* eslint-disable no-undef, no-empty, no-useless-escape */
// Needs the dev server (pnpm --filter @squad/web-host dev) or BASE_URL. Signs in via localStorage, waits for fonts,
// emulates reduced motion for determinism, writes <prefix>-<route>-<w>-<theme>.png.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []),
);
const base = process.env.BASE_URL ?? 'http://localhost:5180';
const out = resolve(args.out ?? '../../docs/design/shots/web-shell');
const routes = (args.routes ?? '/squad,/__gallery').split(',');
const sizes = (args.sizes ?? '390x844,1280x800').split(',').map((s) => s.split('x').map(Number));
const themes = (args.themes ?? 'dark,light').split(',');
const prefix = args.prefix ?? 'shot';
const full = args.full !== 'false';
mkdirSync(out, { recursive: true });

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
} catch {
  browser = await chromium.launch();
}
const session = { userId: 'ana', name: 'Ana', token: 'dev-ana', avatarUrl: '/avatars/ana.png' };
for (const [w, h] of sizes) {
  for (const theme of themes) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce',
      colorScheme: theme,
    });
    await ctx.addInitScript(
      ([s, t]) => {
        try {
          localStorage.setItem('squad.session', JSON.stringify(s));
          localStorage.setItem('squad.theme', t);
        } catch {}
      },
      [session, theme],
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') console.error('console.error', m.text());
    });
    for (const r of routes) {
      await page.goto(base + r, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      const name = `${prefix}-${r.replace(/^\//, '').replace(/[\/#]/g, '_') || 'root'}-${w}-${theme}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: full });
      console.log('wrote', name);
    }
    await ctx.close();
  }
}
await browser.close();
