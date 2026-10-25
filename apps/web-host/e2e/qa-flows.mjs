/* eslint-disable */
import { open, signIn, SHOTS, base } from './lib.mjs';
const out = (k, v) => console.log(k, JSON.stringify(v));
{
  // signin: keyboard + hub unreachable
  const { browser, page, log } = await open();
  await page.goto(base + '/signin');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const f = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 100));
  await page.keyboard.press('ArrowRight');
  out(
    'signin radio after arrow',
    await page.evaluate(() =>
      [...document.querySelectorAll('[role=radio]')].map((r) => r.getAttribute('aria-checked')),
    ),
  );
  await page.route('**/auth/**', (r) => r.abort());
  await page
    .getByRole('button', { name: /Enter the village as/ })
    .click()
    .catch((e) => out('btn', e.message.slice(0, 80)));
  await page.waitForTimeout(1200);
  out('signin unreachable', {
    url: page.url(),
    alert: await page.locator('[role=alert],[role=status]').allTextContents(),
  });
  await page.screenshot({ path: SHOTS + 'signin-unreachable.png' });
  await page.goto(base + '/nope');
  out(
    '404',
    await page
      .locator('body')
      .innerText()
      .then((t) => t.slice(0, 120)),
  );
  await browser.close();
}
{
  // session expiry
  const { browser, page, log } = await open();
  await signIn(page, 'Ana');
  await page.route('**/v1/**', (r) =>
    r.request().url().includes('/stream')
      ? r.continue()
      : r.fulfill({
          status: 401,
          body: '{"error":"unauthorized"}',
          contentType: 'application/json',
        }),
  );
  for (const p of ['/squad/ledger', '/squad/trips', '/squad/mastery', '/squad/personas']) {
    await page.goto(base + p);
    await page.waitForTimeout(1500);
    out('401 ' + p, {
      url: page.url(),
      body: (
        await page
          .locator('main')
          .innerText()
          .catch(() => '')
      )
        .replace(/\s+/g, ' ')
        .slice(0, 160),
    });
    await page.screenshot({ path: SHOTS + 'exp-' + p.replace(/\W+/g, '_') + '.png' });
  }
  out('log', [...new Set(log)].slice(0, 8));
  await browser.close();
}
{
  // personas guard + trips double click + sign out + theme
  const { browser, page, log } = await open();
  await signIn(page, 'Ana');
  await page.goto(base + '/squad/personas');
  await page.waitForTimeout(1200);
  const tabs = page.getByRole('tab');
  out('persona tabs', await tabs.count());
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  out(
    'tab sel',
    await page.evaluate(() =>
      [...document.querySelectorAll('[role=tab]')].map((t) => t.getAttribute('aria-selected')),
    ),
  );
  const ta = page.locator('textarea,input[type=text]').first();
  await ta.fill('qa edit ' + Date.now());
  let dlg = null;
  page.on('dialog', (d) => {
    dlg = d.type();
    d.dismiss();
  });
  await page.getByRole('navigation').getByRole('link', { name: 'Ledger' }).first().click();
  await page.waitForTimeout(800);
  out('guard on nav', {
    url: page.url(),
    dlg,
    dialogEl: await page.locator('[role=dialog],[role=alertdialog]').count(),
  });
  await page.screenshot({ path: SHOTS + 'personas-guard.png' });
  await page.reload().catch(() => {});
  await page.waitForTimeout(800);
  out('reload dialog', dlg);
  await browser.close();
}
{
  const { browser, page, log } = await open();
  await signIn(page, 'Ben');
  await page.goto(base + '/squad/trips');
  await page.waitForTimeout(1500);
  const btns = await page.getByRole('button').allTextContents();
  out(
    'trip buttons',
    btns
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  );
  const reqs = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET') reqs.push(r.method() + ' ' + r.url());
  });
  const vote = page.getByRole('button', { name: /vote|upvote/i }).first();
  if (await vote.count()) {
    await vote.dblclick();
    await page.waitForTimeout(1000);
  }
  out('trip mutations after dblclick', reqs);
  const conf = page.getByRole('button', { name: /confirm|i'm in|count me/i }).first();
  if (await conf.count()) {
    await conf.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: SHOTS + 'trip-confirm.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    out('esc closes sheet', await page.locator('[role=dialog]').count());
  }
  // sign out and theme
  await page
    .getByRole('button', { name: /sign out|log out/i })
    .first()
    .click()
    .catch(async () => {
      await page
        .getByRole('button', { name: /account|menu|Ben/i })
        .first()
        .click()
        .catch(() => {});
      await page
        .getByRole('menuitem', { name: /sign out/i })
        .click()
        .catch(() => {});
    });
  await page.waitForTimeout(800);
  out('after signout', {
    url: page.url(),
    sess: await page.evaluate(() => localStorage.getItem('squad.session')),
  });
  out('log', [...new Set(log)].slice(0, 8));
  await browser.close();
}
