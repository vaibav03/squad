import { actor, api, blocked, expect, shot, test } from '../lib/helpers';
import { GROUP, history, needChat, openChat, say } from '../lib/chat';

const J = 'j5-council';

test('J5 ask the council in chat: three members, ranking, verdict, copy button', async ({ browser }) => {
  await needChat();
  const probe = await api(await (await import('../lib/helpers')).apiLogin('s_ana'), '/v1/council/ask', { method: 'POST', json: {} });
  if (probe.status === 404) blocked('not merged yet: council/ask');
  const ana = await actor(browser, 's_ana');
  await openChat(ana, GROUP);
  await say(ana.page, '@cubbie ask the council: should I switch my major?');
  const card = ana.page.getByRole('article', { name: 'Council answer' }).first();
  await expect(ana.page.getByText(/Council verdict:/).first(), 'J5: the council reply should arrive in the chat').toBeVisible({ timeout: 60_000 });
  await ana.page.waitForTimeout(1500);
  const hasCard = (await card.count()) > 0;
  expect.soft(hasCard, 'E2E-council-card-not-rendered: chat shows the council reply as one flat text paragraph; the CouncilCard (members, ranking, verdict, dissent, Copy verdict) is never rendered for card.type "council"').toBe(true);
  await shot(ana.page, J, '01-council-reply');
  if (hasCard) {
    await card.getByRole('button', { name: /show how each member answered/i }).click();
    await expect(card.locator('.cn-member'), 'J5: three member answers').toHaveCount(3);
    await expect(card.locator('.cn-rank'), 'J5: a ranking section').toBeVisible();
    await expect(card.getByRole('button', { name: /Copy verdict/ }), 'J5: copy button').toBeVisible();
    await shot(ana.page, J, '02-members-ranking');
  }

  // hub snapshot agrees
  const msg = (await history(ana.token, GROUP)).reverse().find((m) => m.card?.type === 'council');
  expect(msg, 'J5: history should hold a council card message').toBeDefined();
  const runId = (msg!.card as { runId: string }).runId;
  const r = await api(ana.token, `/v1/council/${runId}`);
  expect(r.status).toBe(200);
  const res = (await r.json()) as { members: unknown[]; rankings: unknown[]; verdict?: { text: string } };
  expect(res.members.length, 'J5: hub result has 3 members').toBe(3);
  expect(res.rankings.length, 'J5: hub result has rankings').toBeGreaterThan(0);
  expect(res.verdict?.text?.length ?? 0, 'J5: hub verdict text').toBeGreaterThan(5);
  expect.soft(res.verdict && 'dissent' in res.verdict, 'E2E-council-dissent: hub verdict carries a dissent').toBeTruthy();
  expect(ana.pageErrors).toEqual([]);
  await ana.ctx.close();
});
