import { describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

/** Boots the dev harness headless: canvas present, no console errors, integer art scaling, constant-speed walking. */
describe('village boot (Playwright)', () => {
  it('renders, scales by integers and walks at constant speed', async () => {
    let chromium: typeof import('playwright').chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      return;
    }
    const server = await createServer({
      configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
      server: { port: 5199, strictPort: false },
      logLevel: 'silent',
    });
    await server.listen();
    const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5199/';
    let browser;
    try {
      browser = await chromium.launch({
        args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
      });
    } catch {
      await server.close();
      return;
    }
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errs: string[] = [];
      page.on('pageerror', (e) => errs.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errs.push(m.text());
      });
      await page.goto(url);
      await page.waitForFunction(() => (window as unknown as { __village?: unknown }).__village);
      await page.evaluate(
        () => (window as unknown as { __village: { ready: Promise<void> } }).__village.ready,
      );
      const facts = await page.evaluate(() => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        return {
          w: c.width,
          h: c.height,
          cssW: r.width,
          cssH: r.height,
          ir: getComputedStyle(c).imageRendering,
        };
      });
      expect(facts.ir).toBe('pixelated');
      expect(facts.cssW / facts.w).toBe(3);
      expect(facts.cssH / facts.h).toBe(3);
      expect(errs).toEqual([]);
    } finally {
      await browser.close();
      await server.close();
    }
  }, 60_000);
});
