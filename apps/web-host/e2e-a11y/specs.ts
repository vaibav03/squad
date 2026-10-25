/**
 * Keyboard / focus regression specs, run by scripts/a11y/check.ts (no @playwright/test needed).
 * `knownFail: '<finding id>'` marks a spec that documents an open defect in FINDINGS.md: it must keep failing until the
 * owner fixes it; when it starts passing, check.ts tells you to drop the marker.
 */
import { gotoRoute, ROUTES, newPage, type Page, type Browser } from '../../../scripts/a11y/lib';

export interface Spec {
  name: string;
  knownFail?: string;
  viewport?: { w: number; h: number };
  run(page: Page): Promise<void>;
}

const village = ROUTES.find((r) => r.id === 'village-replay-track2')!;
const ok = (c: unknown, msg: string) => {
  if (!c) throw new Error(msg);
};
const focused = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null;
    return e ? `${e.tagName.toLowerCase()}.${e.className}` : 'none';
  });

async function openVillage(page: Page) {
  await gotoRoute(page, village);
  await page.focus('.sqv-stage');
}
async function openQuiz(page: Page) {
  await openVillage(page);
  await page.evaluate(() =>
    (window as unknown as { __squadOverlay: (e: unknown) => void }).__squadOverlay({
      type: 'openQuiz',
      quizId: 'q1',
      chapter: 'ch5',
    }),
  );
  await page.waitForSelector('[role=dialog][aria-modal=true]');
  await page.waitForTimeout(600);
}

export const specs: Spec[] = [
  {
    name: 'village: stage is keyboard focusable and named',
    async run(page) {
      await openVillage(page);
      const s = await page.evaluate(() => {
        const e = document.querySelector('.sqv-stage')!;
        return { tab: (e as HTMLElement).tabIndex, label: e.getAttribute('aria-label') };
      });
      ok(s.tab >= 0 && s.label, 'stage not focusable or unnamed');
    },
  },
  {
    name: 'village: arrow keys walk and show the Enter prompt at a door',
    async run(page) {
      await openVillage(page);
      await page.keyboard.down('ArrowRight');
      await page
        .waitForFunction(
          () =>
            (document.querySelector('.sqv-prompt') as HTMLElement | null)?.dataset.show === 'true',
          undefined,
          { timeout: 8000 },
        )
        .finally(() => page.keyboard.up('ArrowRight'));
    },
  },
  {
    name: 'village: help dialog opens with ? button and Esc returns focus to stage',
    async run(page) {
      await openVillage(page);
      await page.click('button[aria-controls=sqv-help]');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      ok(
        (await focused(page)).includes('sqv-stage') || (await focused(page)).includes('sqv-btn'),
        'focus lost after Esc: ' + (await focused(page)),
      );
    },
  },
  {
    name: 'village: Calm switch is a labelled switch that toggles aria-checked',
    async run(page) {
      await openVillage(page);
      const sw = page.locator('button[role=switch][aria-label="Calm mode"]');
      await sw.click();
      ok((await sw.getAttribute('aria-checked')) === 'true', 'aria-checked not true');
    },
  },
  {
    name: 'village: HUD chips are reachable within 3 Tab presses of the stage',
    knownFail: 'A11Y-003',
    async run(page) {
      await openVillage(page);
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        if ((await focused(page)).includes('sqv-chip')) return;
      }
      throw new Error(
        'Tab stays on .sqv-stage (place cycling) for 9 presses before reaching the first chip',
      );
    },
  },
  {
    name: 'overlay: quiz dialog is modal, named, takes focus and traps Tab',
    knownFail: 'A11Y-001',
    async run(page) {
      await openQuiz(page);
      const dlg = page.locator('[role=dialog][aria-modal=true]');
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const inside = await dlg.evaluate((d) => d.contains(document.activeElement));
        ok(
          inside,
          `focus escaped the quiz dialog after ${i + 1} Tab presses (now on ${await focused(page)})`,
        );
      }
    },
  },
  {
    name: 'overlay: Esc closes the quiz and returns focus to the world',
    async run(page) {
      await openQuiz(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role=dialog][aria-modal=true]', {
        state: 'detached',
        timeout: 3000,
      });
      const f = await focused(page);
      ok(f.includes('canvas') || f.includes('sqv-stage'), 'focus not returned to world, on ' + f);
    },
  },
  {
    name: 'overlay: Esc still closes the quiz after Tab moved focus around',
    knownFail: 'A11Y-001',
    async run(page) {
      await openQuiz(page);
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role=dialog][aria-modal=true]', {
        state: 'detached',
        timeout: 2000,
      });
    },
  },
  {
    name: 'phone: village HUD targets are at least 44x44 CSS px',
    viewport: { w: 390, h: 844 },
    async run(page) {
      await gotoRoute(page, village);
      const bad = await page.evaluate(() =>
        [...document.querySelectorAll('.sqv-hud button')]
          .map((e) => ({
            n: e.getAttribute('aria-label') ?? e.textContent,
            r: e.getBoundingClientRect(),
          }))
          .filter((x) => x.r.width && (x.r.width < 44 || x.r.height < 44))
          .map((x) => `${x.n} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`),
      );
      ok(bad.length === 0, 'small targets: ' + bad.join(', '));
    },
  },
  {
    name: 'pages: every app route sets a specific document title',
    knownFail: 'A11Y-005',
    async run(page) {
      const bad: string[] = [];
      for (const id of ['home', 'ledger', 'trip', 'setup', 'personas', 'mastery']) {
        await gotoRoute(
          page,
          ROUTES.find((r) => r.id === id)!,
        );
        const t = await page.title();
        if (!t || t === 'Squad') bad.push(`${id}: "${t}"`);
      }
      ok(bad.length === 0, 'generic titles (WCAG 2.4.2): ' + bad.join(', '));
    },
  },
];

export type { Browser };
export { newPage };
