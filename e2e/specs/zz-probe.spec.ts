import { actor, expect, test } from '../lib/helpers';
test(`probe`, async ({ browser }) => {
  test.setTimeout(120000);
  const b = await actor(browser, 's_ana', { viewport: { width: 1280, height: 800 } });
  const { page } = b;
  await page.goto('/squad/village');
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(5000);
  await page.getByTestId('chat-dock-open').click();
  await page.waitForTimeout(800);
  console.log(await page.evaluate(() => {
    const root = document.querySelector('.sq-dock-root') as HTMLElement;
    const r = (s: string) => { const e = document.querySelector(s); if (!e) return s + ' none'; const b = e.getBoundingClientRect(); return `${s} y${Math.round(b.top)}-${Math.round(b.bottom)} x${Math.round(b.left)}-${Math.round(b.right)}`; };
    return [root.style.getPropertyValue('--sq-dock-top'), getComputedStyle(root).getPropertyValue('--sq-dock-bottom'), r('.sq-dock-root'), r('.sqd'), r('.sqd-panel'), r('.sqd-pill'), r('.sqv-chips'), r('.sqv-seg'), r('.sqv-clock')].join('\n');
  }));
  await b.ctx.close();
});
