import { actor, expect, shot, test, status } from '../lib/helpers';
import { GROUP, botMsgs, needChat, openChat, say } from '../lib/chat';

const J = 'j2-chat';

test('J2 group chat: grounded cubbie answer with citation chip, visible to Ana and Ben', async ({
  browser,
}) => {
  await needChat();
  const ana = await actor(browser, 's_ana');
  const ben = await actor(browser, 's_ben');
  await openChat(ana, GROUP);
  await openChat(ben, GROUP);
  await shot(ana.page, J, '01-ana-group-open');

  await say(ana.page, '@cubbie what is a z-score?');
  await shot(ana.page, J, '02-question-sent');
  const chip = (p: typeof ana.page) =>
    p
      .locator(
        '[data-testid="chat-message"][data-sender-id="cubbie"] [data-testid="chat-citation-chip"]',
      )
      .first();
  await expect(
    chip(ana.page),
    'J2: Ana should get a cubbie answer with a citation chip',
  ).toBeVisible({ timeout: 40_000 });
  await expect(
    chip(ben.page),
    'J2: Ben should see the same cubbie answer with a citation chip',
  ).toBeVisible({ timeout: 20_000 });
  expect(
    await ben.page.getByText('what is a z-score?').first().isVisible(),
    "J2: Ben sees Ana's question",
  ).toBe(true);
  const aText = await botMsgs(ana.page).last().innerText();
  const bText = await botMsgs(ben.page).last().innerText();
  expect
    .soft(aText.replace(/\s+/g, ' '), 'J2: Ana and Ben should see the same answer text')
    .toBe(bText.replace(/\s+/g, ' '));
  expect(aText, 'J2: answer should mention the z-score topic').toMatch(
    /z-?score|standard deviation/i,
  );
  await shot(ana.page, J, '03-answer-with-chip');
  await shot(ben.page, J, '04-ben-sees-answer');

  const chipText = await chip(ana.page).innerText();
  expect
    .soft(chipText, 'E2E-chip-label: chip should read like "<file> p.N"')
    .toMatch(/p\.?\s*\d+/i);
  await chip(ana.page).click();
  const ex = ana.page.getByTestId('chat-citation-excerpt');
  await expect(ex, 'J2: clicking the chip should open the excerpt').toBeVisible({ timeout: 8_000 });
  expect((await ex.innerText()).trim().length, 'J2: excerpt should contain text').toBeGreaterThan(
    20,
  );
  await shot(ana.page, J, '05-citation-excerpt');

  const s = await status();
  if (s.demo) {
    await expect(
      ana.page.getByTestId('chat-demo-notice'),
      'J2: demo notice must be visible in demo mode',
    ).toBeVisible();
    await expect(ben.page.getByTestId('chat-demo-notice')).toBeVisible();
  }
  expect(ana.pageErrors).toEqual([]);
  expect(ben.pageErrors).toEqual([]);
  await ana.ctx.close();
  await ben.ctx.close();
});
