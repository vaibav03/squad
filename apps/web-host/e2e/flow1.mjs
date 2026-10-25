/* eslint-disable */
import { open, signIn, SHOTS, base } from './lib.mjs';
for (const name of ['Ana', 'Ben', 'Chi', 'Dev']) {
  const { browser, page, log } = await open();
  await signIn(page, name);
  console.log(
    name,
    'signed in',
    await page.evaluate(() =>
      localStorage.getItem('squad.session')?.replace(/"token":"[^"]*"/, '"token":"..."'),
    ),
  );
  for (const label of ['Village', 'Ledger', 'Trip', 'Setup', 'Personas', 'Mastery', 'Home']) {
    const l = page.getByRole('navigation').getByRole('link', { name: label }).first();
    await l.click().catch((e) => log.push('navfail ' + label));
    await page.waitForTimeout(label === 'Village' ? 4000 : 1000);
    console.log(
      name,
      label,
      page.url(),
      await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent,
        cv: document.querySelectorAll('canvas').length,
      })),
    );
    if (name === 'Ana') await page.screenshot({ path: SHOTS + `flow-${name}-${label}.png` });
  }
  console.log(name, 'LOG', [...new Set(log)]);
  await browser.close();
}
