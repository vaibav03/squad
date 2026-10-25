import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { actor, api, apiLogin, expect, test } from '../lib/helpers';
import { GROUP, history, needChat, openChat, say } from '../lib/chat';

// Chat truth (fixture mode): one honest header badge, ONE canonical council card, bounded height, composer always
// visible, newest message in view, no duplicates, one pending/retry state.
const DIR = path.join(os.homedir(), 'Desktop/squad-demo');
const snap = async (page: Page, name: string) => {
  fs.mkdirSync(DIR, { recursive: true });
  await page.screenshot({ path: path.join(DIR, `chat-truth-${name}.png`) }).catch(() => undefined);
};
const ASK = `@cubbie ask the council: should I use recursion or conditioning for problem ${(Date.now() % 90) + 3}?`;

async function composerInView(page: Page) {
  const box = await page.getByTestId('chat-composer-input').boundingBox();
  const vp = page.viewportSize()!;
  expect(box, 'composer exists').not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
}

test('J37 chat truth: header badge, single council card, layout, dedupe, pending/retry', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await needChat();
  const ana = await actor(browser, 's_ana', { viewport: { width: 1280, height: 800 } });
  const { page } = ana;
  await openChat(ana, GROUP);

  // 1. ask the council twice quickly: one prompt, one answer (the stack may hold earlier runs: count the delta)
  await page.waitForTimeout(2500);
  const before = await page.getByTestId('council-chat-card').count();
  const promptsBefore = await page
    .locator('[data-testid="chat-message"][data-own="true"]', { hasText: 'ask the council' })
    .count();
  await say(page, ASK);
  await say(page, ASK);
  const card = page.getByTestId('council-chat-card');
  await expect(card).toHaveCount(before + 1, { timeout: 90_000 });
  await expect(card.last().getByTestId('council-summary')).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  await expect(card, 'exactly one new council answer element').toHaveCount(before + 1);
  const prompts = page.locator('[data-testid="chat-message"][data-own="true"]', {
    hasText: 'ask the council',
  });
  await expect(prompts, 'asking twice quickly does not duplicate the prompt').toHaveCount(
    promptsBefore + 1,
  );

  // no prose duplicate: the verdict text lives only inside the card (and its sr-only twin)
  const verdict = ((await card.last().getByTestId('council-summary').textContent()) ?? '').trim();
  const bubbleProse = page.locator('.sqc-bubble', { hasText: 'Council verdict:' });
  await expect(bubbleProse, 'no plain-text council bubble').toHaveCount(0);
  expect(verdict.length).toBeGreaterThan(5);

  // header: never plain "Live" next to a fixture council
  const badge = page.getByTestId('chat-header-badge');
  const label = ((await badge.textContent()) ?? '').trim();
  const mode = await card.last().getAttribute('data-mode');
  if (mode === 'demo') {
    expect(label).not.toBe('Live');
    expect(label).toMatch(/Fixture council|Example council/);
  }
  await snap(page, '01-header-and-card');

  // 2. member rows collapsed by default, expand
  await expect(card.last().getByTestId('council-member-row').first()).toBeHidden();
  await card.last().getByTestId('council-members-toggle').click();
  const rows = card.last().getByTestId('council-member-row');
  await expect(rows).toHaveCount(3);
  await rows.first().getByRole('button').click();
  await snap(page, '02-members-expanded');

  // 3. card height is bounded, newest message in view, composer visible
  const thread = page.getByTestId('chat-thread');
  const th = (await thread.boundingBox())!.height;
  const ch = (await card.last().boundingBox())!.height;
  expect(ch, 'card <= ~70% of the thread even expanded').toBeLessThanOrEqual(th * 0.75);
  await composerInView(page);

  // 4. long verdict at 1280x800 and 1440x900
  for (const vp of [
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(vp);
    await page.route('**/v1/council/cn_*', async (route) => {
      const res = await route.fetch();
      const j = (await res.json()) as {
        verdict?: { text: string; confidenceNote: string };
        members: { text: string }[];
        notes: string[];
      };
      const long = 'The recursion on states is correct only when every case is covered. '.repeat(
        30,
      );
      if (j.verdict) j.verdict.text = long.slice(0, 1390);
      for (const m of j.members) m.text = long.slice(0, 1390);
      await route.fulfill({ response: res, json: j });
    });
    await page.reload();
    await page.getByTestId('chat-composer-input').waitFor();
    const c = page.getByTestId('council-chat-card').last();
    await expect(c).toBeVisible({ timeout: 30_000 });
    await c.getByTestId('council-members-toggle').click();
    const tall = (await c.boundingBox())!.height;
    const vh = (await page.getByTestId('chat-thread').boundingBox())!.height;
    expect(tall, `card bounded at ${vp.width}x${vp.height}`).toBeLessThanOrEqual(vh * 0.75);
    await composerInView(page);
    const more = c.getByTestId('council-show-full');
    if (await more.count()) {
      await more.click();
      await composerInView(page);
    }
    await snap(page, `03-long-${vp.width}x${vp.height}`);
    await page.unroute('**/v1/council/cn_*');
  }

  // 4b. a fixture council on a live provider: the header names BOTH, never plain "Live"
  await page.route('**/v1/council/cn_*', async (route) => {
    const res = await route.fetch();
    const j = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...j, demo: true, mode: 'demo' } });
  });
  await page.reload();
  await expect(page.getByTestId('council-chat-card').last()).toHaveAttribute('data-mode', 'demo', {
    timeout: 30_000,
  });
  const fixtureLabel = ((await page.getByTestId('chat-header-badge').textContent()) ?? '').trim();
  expect(fixtureLabel).toMatch(/^(Live chat · Example council|Fixture council)$/);
  await snap(page, '03b-fixture-council-header');
  await page.unroute('**/v1/council/cn_*');

  // 5. auto-scroll to newest, and "jump to latest" when scrolled up
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  await page.getByTestId('chat-composer-input').waitFor();
  const nearBottom = () =>
    thread.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 60);
  await say(page, '@cubbie what is a z-score?');
  await expect.poll(nearBottom, { timeout: 60_000 }).toBe(true);
  await thread.evaluate((e) => (e.scrollTop = 0));
  await page.waitForTimeout(300);
  await api(await apiLogin('s_ben'), '/v1/chat/send', {
    method: 'POST',
    json: { chatId: GROUP, text: `hello from the side ${Date.now()}` },
  });
  const pill = page.getByTestId('chat-new-pill');
  await expect(pill).toContainText(/Jump to latest \(1 new\)/, { timeout: 15_000 });
  expect(await nearBottom(), 'scroll position is not yanked').toBe(false);
  await composerInView(page);
  await snap(page, '04-scrolled-up');
  await pill.click();
  expect(await nearBottom()).toBe(true);

  // 6. same z-score exchange 3 times -> one in history, one visible answer
  const z = `@cubbie what is a z-score ${Date.now() % 1000}?`;
  const cid = `e2e_${Date.now()}`;
  for (let i = 0; i < 3; i++)
    await api(ana.token, '/v1/chat/send', {
      method: 'POST',
      json: { chatId: GROUP, text: z, clientId: cid },
    });
  await page.waitForTimeout(6000);
  const hist = (await history(ana.token, GROUP)).filter((m) => m.text === z);
  expect(hist, 'idempotent by clientId: one stored prompt').toHaveLength(1);

  // 7. pending / retry with a "slowed bot": the stream is held back so the answer cannot reach the UI
  await page.reload();
  await page.getByTestId('chat-composer-input').waitFor();
  await page.route('**/v1/chat/stream*', (r) => r.abort());
  await page.route('**/v1/chat/history*', (r) => r.abort());
  const wait = page.getByTestId('chat-wait');
  await page.waitForTimeout(1500);
  const waitBase = await wait.count();
  const q = `@cubbie define variance ${Date.now() % 1000}`;
  await say(page, q);
  await expect(wait, 'one placeholder per trigger message').toHaveCount(waitBase + 1, {
    timeout: 15_000,
  });
  const mine = page.locator(`[data-testid="chat-wait"]`).last();
  await expect(mine.getByTestId('chat-wait-text')).toHaveText('Cubbie is thinking…');
  await expect(mine.getByTestId('chat-wait-text')).toContainText(/taking longer than usual/, {
    timeout: 20_000,
  });
  await expect(wait, 'still one placeholder for it').toHaveCount(waitBase + 1);
  await snap(page, '05-slow-retry');
  await mine.getByTestId('chat-wait-retry').click();
  await expect(wait, 'retry does not stack placeholders').toHaveCount(waitBase + 1);
  const stored = (await history(ana.token, GROUP)).filter((m) => m.text === q);
  expect(stored, 'retry reused the clientId: no second prompt').toHaveLength(1);
  await page.unroute('**/v1/chat/stream*');
  await page.unroute('**/v1/chat/history*');

  expect(ana.pageErrors).toEqual([]);
  await ana.ctx.close();
});
