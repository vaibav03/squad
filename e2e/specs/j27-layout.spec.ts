import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, expect, test } from '../lib/helpers';

/**
 * J27 panel layout: every pair of floating panels is opened on the live village at laptop sizes (and at 200% browser
 * zoom, i.e. half the CSS pixels) and must never overlap each other or the chrome that has to stay reachable: the
 * village HUD, the Chat launcher, the build marker and the dev Agentation button. At most one large panel is open at a
 * time; the chat dock collapses to its pill while a large panel is open and comes back after.
 * Screenshots for review go to ~/Desktop/squad-demo/panels-<size>-<pair>.png (never into the repo).
 */

const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');

const SIZES = [
  { name: '1280x800', w: 1280, h: 800 },
  { name: '1440x900', w: 1440, h: 900 },
  { name: '1920x1080', w: 1920, h: 1080 },
  // 200% browser zoom: the CSS viewport is half as big
  { name: '1280x800-zoom200', w: 640, h: 400 },
  { name: '1440x900-zoom200', w: 720, h: 450 },
];

interface Box {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Floating panels. A panel counts only while it is on screen (not hidden, not transparent). */
const PANELS: Array<[string, string]> = [
  ['chat panel', '.sqd-panel'],
  ['inspector', '.ai-panel'],
  ['room panel', '.rr-panel'],
  ['council panel', '.cn-panel'],
  ['council board', '.cb-panel'],
];
/** Chrome no panel may cover. */
const PROTECTED: Array<[string, string]> = [
  ['HUD chip', '.sqv-hud .sqv-chip'],
  ['HUD control', '.sqv-hud .sqv-seg, .sqv-hud .sqv-clock, .sqv-hud .sqv-menu'],
  ['Chat launcher', '[data-testid="chat-dock-open"]'],
  ['build marker', '[data-testid="build-marker"]'],
  ['Agentation button', '[data-agentation], [class*="agentation" i]'],
  ['room help button', '.rr-help'],
];

/** Visible boxes for a selector list, in viewport coordinates. */
const boxes = (page: Page, list: Array<[string, string]>): Promise<Box[]> =>
  page.evaluate((list) => {
    const out: Box[] = [];
    for (const [name, sel] of list)
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05)
          continue;
        if (el.closest('[hidden]')) continue;
        // an element clipped to nothing by an ancestor (collapsed popover) is not on screen
        if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
        out.push({ name, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    return out;
  }, list);

const hit = (a: Box, b: Box) =>
  a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/** Every overlap between two panels, and between a panel and protected chrome (sentences, empty when fine). */
async function overlaps(page: Page): Promise<string[]> {
  const ps = await boxes(page, PANELS);
  const keep = await boxes(page, PROTECTED);
  const bad: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++)
      if (hit(ps[i]!, ps[j]!)) bad.push(`${ps[i]!.name} overlaps ${ps[j]!.name}`);
    for (const k of keep)
      if (hit(ps[i]!, k)) bad.push(`${ps[i]!.name} covers ${k.name}`);
  }
  // a panel must stay inside the window
  const vp = page.viewportSize()!;
  for (const p of ps)
    if (p.x < -1 || p.y < -1 || p.x + p.w > vp.width + 1 || p.y + p.h > vp.height + 1)
      bad.push(`${p.name} leaves the window`);
  return bad;
}

/** Number of large panels on screen (everything in PANELS except the chat panel). */
async function largeOpen(page: Page): Promise<number> {
  return (await boxes(page, PANELS.slice(1))).length;
}
const chatPanelVisible = async (page: Page) => (await boxes(page, PANELS.slice(0, 1))).length > 0;

async function snap(page: Page, size: string, pair: string): Promise<void> {
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `panels-${size}-${pair}.png`) });
  } catch {
    /* the desktop copy is a convenience */
  }
}

interface W {
  scene: unknown;
  interactables: { list(): Array<{ id: string; onActivate(): void }> };
}
type Win = { __world?: { debug: { ctx(): W | undefined } } };

const fire = (page: Page, name: string) =>
  page.evaluate((n) => globalThis.dispatchEvent(new CustomEvent(n)), name);

/** Close whatever is open and wait until nothing floats. */
async function closeAll(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    if ((await largeOpen(page)) === 0 && !(await chatPanelVisible(page))) return;
    if (await chatPanelVisible(page)) await page.getByTestId('chat-dock-close').click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
  }
}

for (const size of SIZES) {
  test(`J27 panels never overlap each other or the HUD at ${size.name}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const b = await actor(browser, 's_ana', { viewport: { width: size.w, height: size.h } });
    const { page } = b;
    try {
      await page.goto('/squad/village');
      await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('.sq-world__loading')).toHaveCount(0, { timeout: 60_000 });
      await page.waitForFunction(() => (window as unknown as Win).__world?.debug?.ctx?.(), null, {
        timeout: 25_000,
      });
      await page.waitForTimeout(2500);
      const pill = page.getByTestId('chat-dock-open');
      const settled = () => page.waitForTimeout(700);

      // the baseline: HUD, launcher and build marker themselves never overlap a panel (chat open on its own)
      await pill.click();
      await expect(page.locator('.sqd-panel')).toBeVisible();
      await settled();
      expect(await overlaps(page), 'chat alone').toEqual([]);
      await snap(page, size.name, 'chat');

      // chat + inspector: the inspector opens, the chat folds to its pill
      await page.locator('.sqv-hud .sqv-chip').first().click();
      await expect(page.locator('.ai-panel[data-state="open"]')).toBeVisible();
      await settled();
      expect(await largeOpen(page)).toBe(1);
      expect(await chatPanelVisible(page), 'chat folds while the inspector is open').toBe(false);
      await expect(pill).toBeVisible();
      expect(await overlaps(page), 'chat + inspector').toEqual([]);
      await snap(page, size.name, 'chat-inspector');

      // inspector + board: opening the board lets the inspector go (one large panel at a time)
      await fire(page, 'squad:council-board-open');
      await expect(page.locator('.cb-panel')).toBeVisible({ timeout: 10_000 });
      await settled();
      expect(await largeOpen(page), 'inspector + board: one large panel').toBe(1);
      expect(await overlaps(page), 'inspector + board').toEqual([]);
      await snap(page, size.name, 'inspector-board');
      await page.keyboard.press('Escape');
      await expect(page.locator('.cb-panel')).toHaveCount(0);
      await settled();
      // the chat comes back once nothing large is open
      await expect(page.locator('.sqd-panel')).toBeVisible();
      expect(await overlaps(page), 'chat restored').toEqual([]);

      // plan + chat, mastery + chat
      for (const [evt, shot] of [
        ['squad:plan-open', 'plan-chat'],
        ['squad:mastery-open', 'mastery-chat'],
      ] as const) {
        await fire(page, evt);
        await expect(page.locator('.rr-panel')).toBeVisible({ timeout: 10_000 });
        await settled();
        expect(await largeOpen(page), `${shot}: one large panel`).toBe(1);
        expect(await chatPanelVisible(page), `${shot}: chat folds`).toBe(false);
        expect(await overlaps(page), shot).toEqual([]);
        await snap(page, size.name, shot);
        await page.keyboard.press('Escape');
        await expect(page.locator('.rr-panel')).toHaveCount(0);
        await settled();
        await expect(page.locator('.sqd-panel')).toBeVisible();
      }

      // chat + room panel: step into the Council Hall; its panels and the room help button
      await page.evaluate(() =>
        (window as unknown as Win)
          .__world!.debug.ctx()!
          .interactables.list()
          .find((i) => i.id === 'enter-council-hall')!
          .onActivate(),
      );
      await expect(page.locator('.rr-layer[data-room="council-hall"]')).toBeVisible({
        timeout: 15_000,
      });
      await page.waitForTimeout(1200);
      expect(await largeOpen(page), 'hall: at most one large panel').toBeLessThanOrEqual(1);
      expect(await overlaps(page), 'chat + council panel').toEqual([]);
      await snap(page, size.name, 'chat-council');
      await closeAll(page);
      await page.locator('.rr-help').click();
      await expect(page.locator('.rr-panel')).toBeVisible({ timeout: 10_000 });
      await settled();
      expect(await largeOpen(page), 'room panel: one large panel').toBe(1);
      expect(await chatPanelVisible(page), 'chat folds for the room panel').toBe(false);
      expect(await overlaps(page), 'chat + room panel').toEqual([]);
      await snap(page, size.name, 'chat-room');
      expect(b.pageErrors).toEqual([]);
    } finally {
      await b.ctx.close();
    }
  });
}
