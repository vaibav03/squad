// J39 acceptance: the first-run flow. A fresh user lands on Connect first, uses the Canvas demo workspace, reviews the
// import, chooses sharing and arrives in the group chat. A returning (connected) user skips all of it.
// Run on a non-5173 origin, e.g. E2E_WEB_PORT=5290. The fresh state comes from the dev-only reset endpoint
// (POST /v1/dev/reset-onboarding), which only resets the caller's own onboarding and connections.
import { test, expect } from '@playwright/test';
import { WEB } from '../lib/env';
import { actor, api, type Actor } from '../lib/helpers';

let ana: Actor;
test.beforeAll(async ({ browser }) => {
  expect(new URL(WEB).port).not.toBe('5173');
  ana = await actor(browser, 's_ana');
  const r = await api(ana.token, '/v1/dev/reset-onboarding', { method: 'POST', json: {} });
  expect(r.status).toBe(200);
});
test.afterAll(async () => ana?.ctx.close());

test('fresh user: connect first, Canvas demo, review, sharing, group chat', async () => {
  const p = ana.page;
  await p.goto('/squad/setup');
  await expect(p).toHaveURL(/\/squad\/welcome-tour\/connect$/);
  await expect(p.getByText('Step 2 of 4')).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Connect your learning context' })).toBeFocused();
  // the one primary button is disabled until something is connected
  await expect(p.getByRole('button', { name: 'Continue to review' })).toBeDisabled();

  await p.getByRole('button', { name: 'Use Canvas demo workspace' }).click();
  await expect(p.getByTestId('phase-line').first()).toContainText('Demo data');
  await expect(p.getByTestId('phase-line').first()).not.toContainText(/^Live/);
  // the top bar never says Live while the content is Demo
  await expect(p.getByTestId('system-status')).toContainText('Demo data');

  await p.getByRole('button', { name: 'Use Google demo workspace' }).click();
  await expect(p.getByTestId('phase-line').nth(1)).toContainText('Demo data');

  await p.getByRole('button', { name: 'Continue to review' }).click();
  await expect(p).toHaveURL(/\/welcome-tour\/review$/);
  await expect(p.getByText('Step 3 of 4')).toBeVisible();
  await expect(p.getByTestId('review-import')).toBeVisible();
  // review and share read the same numbers: Canvas demo = 3 courses, Google demo = 2 Drive documents
  const summary = (await p.getByTestId('review-summary').innerText()).replace(/\s+/g, ' ');
  expect(summary).toContain('Courses: 3');
  expect(summary).toContain('Drive documents: 2');

  await p.getByRole('button', { name: 'Looks right, continue' }).click();
  await expect(p).toHaveURL(/\/welcome-tour\/share$/);
  await expect(p.getByText('Step 4 of 4')).toBeVisible();
  const share = p.getByTestId('share-list');
  await expect(share).toContainText('Private');
  await expect(share).toContainText('Courses (3)');
  await expect(share).toContainText('Drive documents (2)');
  await expect(share).not.toContainText('Courses (0)');

  // browser back returns to the previous step
  await p.goBack();
  await expect(p).toHaveURL(/\/welcome-tour\/review$/);
  await p.goForward();

  await p.getByRole('button', { name: 'Open the group chat' }).click();
  await expect(p).toHaveURL(/\/squad\/chat/);
  await expect(p.getByTestId('context-gate')).toHaveCount(0);
});

test('returning connected user skips setup and goes straight to the app', async () => {
  const p = ana.page;
  await p.goto('/squad/setup');
  await expect(p).toHaveURL(/\/squad$/);
  await p.goto('/squad/chat');
  await expect(p.getByTestId('context-gate')).toHaveCount(0);
});

test('skip link targets this page main region (not another route)', async () => {
  const p = ana.page;
  await p.goto('/squad/chat');
  const skip = p.locator('a.sq-shell__skip');
  await expect(skip).toHaveAttribute('href', '/squad/chat#main');
});
