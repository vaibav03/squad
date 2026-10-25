import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, api, apiLogin, expect, test } from '../lib/helpers';

// J42: the Council Hall interior (table and seated agents) stays visible. The council panel is ONE dock: a right
// column (<= 38% width) on wide screens, a bottom sheet (<= 40% height) on narrow ones, and neither covers the table.
const OUT = path.join(os.homedir(), 'Desktop', 'squad-demo');
const VIEWPORTS = [
  { width: 822, height: 678 },
  { width: 1280, height: 800 },
] as const;
type Box = { x: number; y: number; width: number; height: number };
const hit = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The interior image and its central table band, in page pixels. */
async function interiorBoxes(page: Page): Promise<{ room: Box; table: Box }> {
  return page.evaluate(() => {
    const g = (window as any).__world.debug.game();
    const sc = g.scene.getScenes(true)[0];
    const img = sc.children.list.find((c: any) => c.texture?.key === 'scene-interior');
    const cv = g.canvas.getBoundingClientRect();
    const k = cv.width / g.scale.width;
    const room = { x: cv.x + img.x * k, y: cv.y + img.y * k, width: img.displayWidth * k, height: img.displayHeight * k };
    // the table and its seats: middle 60% of the width, rows 35%..85% of the room
    const table = {
      x: room.x + room.width * 0.2,
      y: room.y + room.height * 0.3,
      width: room.width * 0.6,
      height: room.height * 0.4,
    };
    return { room, table };
  });
}

for (const vp of VIEWPORTS) {
  test(`J42 council hall interior and compact dock at ${vp.width}x${vp.height}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
    const { page } = a;
    await page.setViewportSize(vp);
    await page.goto('/squad/village');
    await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
    await page.waitForFunction(() => (window as any).__world?.debug?.ctx?.(), null, { timeout: 25_000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (window as any).__world.openRoom('council-hall', { calm: true }));
    const dock = page.getByTestId('council-dock');
    await expect(dock).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(600);
    // the room scene is the Council Hall interior, drawn on the stage
    await expect(page.locator('.rr-layer[data-room="council-hall"]')).toBeVisible();

    const check = async (tag: string) => {
      const d = (await dock.boundingBox())!;
      const { room, table } = await interiorBoxes(page);
      if (vp.width >= 1000) {
        expect(d.width / vp.width, `${tag} dock width`).toBeLessThanOrEqual(0.38 + 0.005);
        expect(d.x + d.width).toBeGreaterThan(vp.width - 40);
      } else expect(d.height / vp.height, `${tag} dock height`).toBeLessThanOrEqual(0.4);
      expect(await page.getByTestId('council-dock').count()).toBe(1);
      expect(hit(d, table), `${tag} dock covers the table`).toBe(false);
      const st = page.getByTestId('council-stage');
      if (await st.isVisible().catch(() => false)) {
        const sb = (await st.boundingBox())!;
        expect(hit(sb, table), `${tag} stage covers the table`).toBe(false);
        expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height);
      }
      expect(room.width).toBeGreaterThan(300);
    };
    await check('empty');
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `hall-visible-enter-${vp.width}x${vp.height}.png`) });

    // a finished council result
    const tok = await apiLogin('s_ana');
    await expect
      .poll(async () => ((await (await api(tok, '/v1/council/runs')).json()) as { runs: { status: string }[] }).runs.every((x) => x.status !== 'running'), { timeout: 60_000 })
      .toBe(true);
    const res = await api(tok, '/v1/council/ask', { method: 'POST', json: { question: 'Why does a higher bond yield mean a lower price?', transport: 'stream' } });
    const { id } = (await res.json()) as { id: string };
    await page.evaluate((rid) => window.dispatchEvent(new CustomEvent('squad:council-started', { detail: { id: rid, councilKey: 'ask', transport: 'stream' } })), id);
    await expect(page.getByTestId('cb-agent-row').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('council-seat').first()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => ((await (await api(tok, `/v1/council/runs`)).json()) as { runs: { id: string; status: string }[] }).runs.find((x) => x.id === id)?.status, { timeout: 60_000 })
      .toBe('done');
    await page.waitForTimeout(1500);
    await expect(dock.getByTestId('council-technical')).not.toHaveAttribute('open', '');
    await page.screenshot({ path: path.join(OUT, `hall-visible-result-${vp.width}x${vp.height}.png`) });
    await check('result');

    // collapse: one compact bar
    await page.getByTestId('council-dock-toggle').click();
    const d2 = (await dock.boundingBox())!;
    expect(d2.height).toBeLessThan(70);
    await a.ctx.close();
  });
}
