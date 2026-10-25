import { actor, expect, test } from '../lib/helpers';
for (const [w, h] of [[1280, 800], [640, 400]] as const)
test(`probe ${w}`, async ({ browser }) => {
  test.setTimeout(120000);
  const b = await actor(browser, 's_ana', { viewport: { width: w, height: h } });
  const { page } = b;
  await page.goto('/squad/village');
  await expect(page.locator('.sqv-stage')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(6000);
  const r = await page.evaluate(() => {
    const q = (s: string) => Array.from(document.querySelectorAll(s)).map((e) => { const r = e.getBoundingClientRect(); return `${s} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; });
    return [...q('.sq-world'), ...q('.sqv-stage'), ...q('.sqv-hud'), ...q('.sqv-chips'), ...q('.sqv-seg'), ...q('.sqv-clock'), ...q('.sqv-menu'), ...q('[data-testid=chat-dock-open]'), ...q('[data-testid=build-marker]'), ...q('[data-agentation]'), ...q('[class*=agentation]'), ...q('nav'), ...q('header')];
  });
  console.log(r.join('\n'));
  await page.screenshot({ path: `/private/tmp/claude-501/-Users-vaibav/8031809f-fd1a-4764-881f-1dbd71387b9d/scratchpad/probe-${w}.png` });
  await b.ctx.close();
});
