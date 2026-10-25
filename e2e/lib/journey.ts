// Shared checks for the first-time customer journey spec (j36): every checkpoint asserts the same things.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export const UX_DIR = path.join(os.homedir(), 'Desktop', 'squad-demo');

/** Words a first-time customer must never meet in primary copy (case-insensitive). `webhook` is allowed only inside collapsed details. */
export const BANNED = [
  /\bA2A\b/i,
  /\bSSE\b/i,
  /\bPSI\b/i,
  /\benvelopes?\b/i,
  /\btiers?\b/i,
  /\bmesh\b/i,
  /\bxref\b/i,
  /\bwebhooks?\b/i,
  /FORCE_FAKE_LLM/,
  /HUB_ADMIN_TOKEN/,
  /\bGlass Box\b/i,
];

export async function shot(page: Page, name: string): Promise<string> {
  fs.mkdirSync(UX_DIR, { recursive: true });
  const file = path.join(UX_DIR, `ux-${name}.png`);
  await page.screenshot({ path: file }).catch(() => undefined);
  return file;
}

/** Visible text of the app chrome plus the page (collapsed <details> and hidden nodes are not part of innerText). */
export const visibleText = (page: Page): Promise<string> =>
  page.evaluate(() => document.body.innerText || '');

export async function expectNoJargon(page: Page, where: string): Promise<void> {
  const t = await visibleText(page);
  for (const re of BANNED) expect(t, `${where}: banned term ${re} in primary copy`).not.toMatch(re);
}

/** One visible primary-variant call to action inside the page (not the chrome). */
export async function expectOnePrimary(page: Page, where: string): Promise<void> {
  const n = await page.evaluate(() => {
    const vis = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    return Array.from(
      document.querySelectorAll(
        'main .sq-btn--primary, main .lv-btn--primary, main [data-primary="true"]',
      ),
    ).filter(vis).length;
  });
  expect(n, `${where}: exactly one primary CTA (found ${n})`).toBe(1);
}

export async function expectTitleAndNext(
  page: Page,
  where: string,
  o: { title: RegExp; next?: boolean; heading?: RegExp },
): Promise<void> {
  await expect.poll(() => page.title(), { message: `${where}: document title` }).toMatch(o.title);
  const h1 = page.locator('main h1, main [data-page-title]').first();
  await expect(h1, `${where}: page heading`).toBeVisible({ timeout: 20_000 });
  if (o.heading) await expect(h1).toHaveText(o.heading);
  if (o.next !== false)
    await expect(
      page.getByTestId('page-next').first(),
      `${where}: a "what happens next" line`,
    ).toBeVisible();
}

/** After a client-side navigation focus is on the main landmark or the page heading, never lost on <body>. */
export async function expectFocusOnPage(page: Page, where: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          if (!a || a === document.body) return 'body';
          if (a.id === 'main' || a.tagName === 'MAIN') return 'main';
          if (a.hasAttribute('data-page-title') || /^H[12]$/.test(a.tagName)) return 'heading';
          return a.closest('main') ? 'inside-main' : `other:${a.tagName}`;
        }),
      { message: `${where}: focus lands on the page`, timeout: 8000 },
    )
    .toMatch(/^(main|heading|inside-main)$/);
}

const NOT_FOUND =
  /Nothing at this address|We could not find|Page not found|is on its way|could not load/i;

/** Every internal link in the header and the page, de-duplicated. */
export async function internalLinks(page: Page): Promise<string[]> {
  const hrefs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map(
      (a) => a.getAttribute('href') ?? '',
    ),
  );
  return [...new Set(hrefs.filter((h) => /^\/(squad|welcome|join)/.test(h)))];
}

/** Open every link in a scratch page and assert it resolves to a rendered, non-404, non-empty page (redirects allowed). */
export async function expectNoDeadLinks(
  scratch: Page,
  links: string[],
  seen: Map<string, string>,
  where: string,
): Promise<number> {
  let n = 0;
  for (const href of links) {
    if (seen.has(href)) continue;
    await scratch.goto(href, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(
        () =>
          scratch.evaluate(() => {
            const el = document.querySelector('main') ?? document.getElementById('root');
            const t = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
            const ok = (t.length > 20 || !!el?.querySelector('canvas')) && !/\bLoading\b/.test(t);
            return ok ? 'ok' : 'wait';
          }),
        { timeout: 25_000, message: `${where}: ${href} renders` },
      )
      .toBe('ok');
    const body = await scratch.locator('body').innerText();
    expect(body, `${where}: ${href} is not a dead end`).not.toMatch(NOT_FOUND);
    seen.set(href, scratch.url());
    n++;
  }
  return n;
}

/** Floating panels (selectors shared with j27) must not overlap each other or the decision card. */
const PANELS = [
  '.sqd-panel',
  '.ai-panel',
  '.rr-panel',
  '.cn-panel',
  '.cb-panel',
  '.pl-panel',
  '.ms-panel',
];
export async function expectNoOverlap(
  page: Page,
  where: string,
  keepClear: string[] = [],
): Promise<void> {
  const boxes = await page.evaluate(
    ([panels, clear]) => {
      const out: { n: string; x: number; y: number; w: number; h: number }[] = [];
      for (const sel of [...(panels as string[]), ...(clear as string[])])
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || +cs.opacity < 0.1)
            continue;
          out.push({ n: sel, x: r.x, y: r.y, w: r.width, h: r.height });
        }
      return out;
    },
    [PANELS, keepClear],
  );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.n === b.n) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      expect(ix > 2 && iy > 2, `${where}: ${a.n} overlaps ${b.n}`).toBe(false);
    }
}

export const one = (l: Locator) => l.first();
