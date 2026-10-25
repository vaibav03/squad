import { expect, shot, test, actor, note, chatMerged } from '../lib/helpers';

const J = 'j12-mobile';
const PHONE = { width: 390, height: 844 };
const PAGES: [string, string][] = [
  ['home', '/squad'],
  ['village', '/squad/village'],
  ['setup', '/squad/setup/phone'],
  ['personas', '/squad/personas'],
  ['ledger', '/squad/ledger/task_trip_cabo'],
  ['trip', '/squad/trips/trip_cabo'],
  ['mastery', '/squad/mastery'],
];

test('J12 every page fits a 390x844 phone with no horizontal scroll and no page errors', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const paths = [...PAGES];
  if (await chatMerged()) paths.push(['chat', '/squad/chat']);
  const a = await actor(browser, 's_ana', { viewport: PHONE });
  const overflow: string[] = [];
  for (const [name, p] of paths) {
    await a.page.goto(p);
    await a.page.waitForTimeout(name === 'village' ? 4000 : 1800);
    const m = await a.page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    if (m.sw > m.cw + 1) overflow.push(`${name} (${m.sw}>${m.cw})`);
    await shot(a.page, J, name);
  }
  note(`pages checked: ${paths.map((p) => p[0]).join(', ')}`);
  expect(overflow, 'pages with horizontal scroll').toEqual([]);
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});

test('J12 keyboard only: skip link, tab to the village, camera buttons, back out', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad');
  await expect(page.getByText('Enter the Village').first()).toBeVisible();
  const firstStops: string[] = [];
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    const label = await page.evaluate(() => (document.activeElement?.textContent ?? '').trim());
    firstStops.push(label.slice(0, 25));
    if (
      /^Enter the Village/i.test(label) &&
      (await page.evaluate(() => document.activeElement?.tagName)) === 'A'
    )
      reached = true;
  }
  note(`tab order: ${firstStops.join(' > ')}`);
  expect(reached, 'Enter the Village reachable by Tab').toBe(true);
  const outline = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return `${s.outlineStyle}/${s.outlineWidth}/${s.boxShadow}`;
  });
  expect(outline, 'focused control must show a focus ring').not.toBe('none/0px/none');
  note(
    `focused before Enter: ${await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      return e.tagName + '|' + (e.getAttribute('href') ?? '') + '|' + e.className;
    })}`,
  );
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/squad\/village/, { timeout: 15_000 });
  await expect(page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Zoom', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('switch', { name: 'Calm mode' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('switch', { name: 'Calm mode' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await shot(page, J, 'keyboard-village');
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});
