/* eslint-disable */
// Regression W-2: reloading with unsaved persona edits must trigger beforeunload.
import { open, signIn, base } from './lib.mjs';
const { browser, page } = await open();
await signIn(page, 'Ana');
await page.goto(base + '/squad/personas');
await page.waitForTimeout(1200);
const clean = await page.evaluate(() => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
await page.getByRole('radio').nth(1).click({ force: true });
const dirty = await page.evaluate(() => {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
console.log({ clean, dirty });
await browser.close();
if (clean || !dirty) {
  console.error('FAIL');
  process.exit(1);
}
