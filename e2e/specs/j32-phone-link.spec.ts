// J32: real phone linking in Setup (dev code path). A fresh account links a fixture number to ITSELF (no session swap),
// the wrong code is refused, and Home flips "Link your phone" to Done only after verification.
// Requires HUB_DEV_LOGIN=1 (the e2e stack default). Fixture numbers only (555 range); nothing real.
import { test, expect } from '@playwright/test';
import { HUB } from '../lib/env';
import { shot } from '../lib/helpers';

const stamp = Date.now().toString(36);
const J = 'phone-link';
const post = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(`${HUB}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
};

test('J32 link a phone from Setup: dev code, wrong code refused, Home done only after verify', async ({
  browser,
}) => {
  const email = `phone.${stamp}@example.com`;
  const s = await post('/v1/auth/start', { name: 'Pia Phone', email });
  const v = await post('/v1/auth/verify', {
    challengeId: s.json.challengeId,
    code: s.json.devCode,
  });
  const token = v.json.token as string;
  await post('/v1/squads', { name: `Phone Group ${stamp}`, course: 'CS 101' }, token);

  const ctx = await browser.newContext();
  await ctx.addInitScript((t) => localStorage.setItem('squad.token', t), token);
  const page = await ctx.newPage();

  await page.goto('/squad');
  const row = page.getByText('Link your phone').locator('xpath=ancestor::li');
  await expect(row.getByText('To do')).toBeVisible();

  await page.goto('/squad/setup/phone');
  await expect(page.getByText('Demo step')).toHaveCount(0);
  await page.getByLabel('Mobile number').fill('4155550134');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Code shown here (dev)')).toBeVisible();
  const code = (await page.getByTestId('phone-dev-code').textContent()) ?? '';
  expect(code).toMatch(/^\d{6}$/);
  await shot(page, J, 'dev-code');

  // wrong code first
  const wrong = code === '000001' ? '000002' : '000001';
  await page.getByLabel('6-digit code').fill(wrong);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/That code is not right/)).toBeVisible();
  await expect(page.getByText('Phone linked')).toHaveCount(0);
  await page.goto('/squad');
  await expect(row.getByText('To do')).toBeVisible(); // not done before verification

  await page.goto('/squad/setup/phone');
  await page.getByLabel('Mobile number').fill('4155550134');
  const me = await fetch(`${HUB}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  const before = (await me.json()) as { user: { id: string }; phoneVerified: boolean };
  expect(before.phoneVerified).toBe(false);
  await page.waitForTimeout(31_000); // resend cooldown on a fresh start
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByTestId('phone-dev-code')).toBeVisible();
  const code2 = (await page.getByTestId('phone-dev-code').textContent()) ?? '';
  await page.getByLabel('6-digit code').fill(code2);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Phone linked')).toBeVisible();

  const after = (await (
    await fetch(`${HUB}/v1/me`, { headers: { authorization: `Bearer ${token}` } })
  ).json()) as { user: { id: string }; phoneVerified: boolean };
  expect(after.user.id).toBe(before.user.id); // same account: no session swap
  expect(after.phoneVerified).toBe(true);

  await page.goto('/squad');
  await expect(row.getByText('Done')).toBeVisible();
  await shot(page, J, 'home-done');
  await ctx.close();
});
