import { actor, api, collectSse, expect, shot, test } from '../lib/helpers';
import { GROUP, botMsgs, botCount, history, needChat, openChat, say, waitBot } from '../lib/chat';

const J = 'j3-dm';
const LEAK = /\$\s?180|therapy/i;

test('J3 private DM: "am I behind?" goes to Ana\'s DM only, group gets a pointer', async ({
  browser,
}) => {
  await needChat();
  const ana = await actor(browser, 's_ana');
  const ben = await actor(browser, 's_ben');
  await openChat(ana, GROUP);
  await openChat(ben, GROUP);
  const before = await botCount(ana.token, 'dm:s_ana');
  await say(ana.page, '@cubbie am I behind?');
  await expect(
    ana.page.getByText('Sent you a DM.').first(),
    'J3: group should show the pointer to Ana',
  ).toBeVisible({ timeout: 40_000 });
  await expect(
    ben.page.getByText('Sent you a DM.').first(),
    'J3: group should show the pointer to Ben too',
  ).toBeVisible({ timeout: 20_000 });
  await shot(ben.page, J, '01-group-pointer');
  const grp = (await history(ana.token, GROUP)).filter((m) => m.sender.kind === 'persona');
  expect(grp.at(-1)?.text.trim(), 'J3: the only group reply must be the pointer').toBe(
    'Sent you a DM.',
  );
  const dm = await waitBot(ana.token, 'dm:s_ana', () => true);
  expect(dm, 'J3: Ana should receive a private DM reply').toBeDefined();
  expect(await botCount(ana.token, 'dm:s_ana')).toBeGreaterThan(before);
  await ana.page.getByTestId('chat-row-dm:s_ana').click();
  await expect(ana.page.getByTestId('chat-privacy-badge')).toBeVisible();
  await expect(botMsgs(ana.page).first()).toBeVisible({ timeout: 15_000 });
  await shot(ana.page, J, '02-ana-dm');
  expect(
    await ben.page.getByTestId('chat-row-dm:s_ana').count(),
    "J3: Ben must not see a row for Ana's DM",
  ).toBe(0);
  expect(
    (await history(ben.token, 'dm:s_ben')).filter((m) => m.sender.kind === 'persona').length,
    "J3: Ben's own DM has no bot reply",
  ).toBe(0);
  await ana.ctx.close();
  await ben.ctx.close();
});

test('J3 privacy sentinels: Ana\'s "$180 therapy" never reaches Ben, Chi or Dev', async ({
  browser,
}) => {
  await needChat();
  const ana = await actor(browser, 's_ana');
  const others = [
    await actor(browser, 's_ben'),
    await actor(browser, 's_chi'),
    await actor(browser, 's_dev'),
  ];
  await openChat(ana, 'dm:s_ana');
  for (const o of others) await openChat(o, GROUP);
  // listen on the streams while the sentinel is planted
  const streams = others.map((o) => [
    collectSse('/v1/chat/stream', o.token, 9000),
    collectSse('/v1/squad/stream', o.token, 9000),
  ]);
  await new Promise((r) => setTimeout(r, 800));
  await say(ana.page, 'my budget: I spend $180 on therapy each month, keep it private');
  await expect(ana.page.getByText(/\$180 on therapy/).first()).toBeVisible();
  await waitBot(ana.token, 'dm:s_ana', () => true, 15_000);
  await shot(ana.page, J, '03-sentinel-planted');
  const raw = await Promise.all(streams.map((s) => Promise.all(s)));
  for (const [i, o] of others.entries()) {
    await o.page.goto('/squad/chat');
    await o.page.waitForTimeout(800);
    await o.page.goto('/squad/village');
    await o.page.waitForTimeout(1200);
    const dom = await o.page.evaluate(() => document.body.innerText);
    expect(dom, `J3: ${o.id} DOM leaked the sentinel`).not.toMatch(LEAK);
    for (const route of [
      '/v1/chat/chats',
      `/v1/chat/history?chatId=${encodeURIComponent(GROUP)}&limit=100`,
      `/v1/chat/history?chatId=dm:${o.id}`,
    ]) {
      const r = await api(o.token, route);
      expect(await r.text(), `J3: ${o.id} ${route} leaked the sentinel`).not.toMatch(LEAK);
    }
    const [chatSse, squadSse] = raw[i]!;
    expect(
      chatSse.length + squadSse.length,
      `J3: ${o.id} SSE streams should have connected`,
    ).toBeGreaterThan(0);
    expect(chatSse, `J3: ${o.id} /v1/chat/stream leaked the sentinel`).not.toMatch(LEAK);
    expect(squadSse, `J3: ${o.id} /v1/squad/stream leaked the sentinel`).not.toMatch(LEAK);
    const leaked = o.bodies.filter((b) => /\/v1\//.test(b.split('\n')[0]!) && LEAK.test(b));
    expect(
      leaked.map((b) => b.split('\n')[0]),
      `J3: ${o.id} saw API bodies containing the sentinel`,
    ).toEqual([]);
    const peek = await api(o.token, '/v1/chat/history?chatId=dm:s_ana');
    expect(peek.status, `J3: ${o.id} reading Ana's DM history must be 403`).toBe(403);
  }
  await shot(others[0]!.page, J, '04-ben-village-clean');
  for (const a of [ana, ...others]) await a.ctx.close();
});
