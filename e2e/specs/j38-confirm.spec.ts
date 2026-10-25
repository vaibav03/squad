import { api, apiLogin, actor, expect, test } from '../lib/helpers';

/**
 * J38: a confirm that is NOT a trip (the debate verdict, "Which side argued better?") must be answerable from the
 * village sheet. Yes reaches the bot (the debate continues and posts its verdict), No/decline does not break, and a
 * task that expired says so instead of "Nothing was shared".
 */
const GROUP = 'group:sq_demo';
const j = async <T>(r: Response): Promise<T> => (await r.json()) as T;
interface Msg {
  text: string;
  card?: { type: string; taskId?: string; status?: string; options?: string[] };
}
const groupText = async (tok: string) =>
  (
    await j<{ messages: Msg[] }>(
      await api(tok, `/v1/chat/history?chatId=${encodeURIComponent(GROUP)}`),
    )
  ).messages.map((m) => m.text ?? '');

/** Teammates vote through the same generic endpoint, so the debate (which waits for every vote) can finish. */
async function teammatesVote(topic: string) {
  for (const id of ['s_ben', 's_chi', 's_dev']) {
    const t = await apiLogin(id);
    await expect
      .poll(
        async () => {
          const h = await j<{ messages: (Msg & { card?: { question?: string } })[] }>(
            await api(t, `/v1/chat/history?chatId=${encodeURIComponent(`dm:${id}`)}`),
          );
          const c = h.messages.find(
            (m) =>
              m.card?.type === 'confirm' &&
              m.card.status === 'pending' &&
              m.card.question?.includes(topic),
          )?.card;
          if (!c?.taskId) return false;
          const r = await api(t, `/v1/confirms/${c.taskId}`, {
            method: 'POST',
            json: { yes: true, optionId: c.options?.[0] },
          });
          return r.status === 200;
        },
        { timeout: 80_000 },
      )
      .toBe(true);
  }
}

async function startDebate(tok: string, topic: string) {
  const r = await api(tok, '/v1/chat/send', {
    method: 'POST',
    json: { chatId: GROUP, text: `@cubbie debate: ${topic}` },
  });
  expect(r.status).toBeLessThan(300);
}

test('J38 a debate confirm: Yes in the village sheet reaches the bot and the debate continues', async ({
  browser,
}) => {
  const tok = await apiLogin('s_ana');
  const a = await actor(browser, 's_ana');
  await a.page.goto('/squad/village');
  await expect(a.page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  const verdicts = async () =>
    (await groupText(tok)).filter((t) => /Chair:|for, \d+ against/.test(t)).length;
  const before = await verdicts();
  await startDebate(tok, 'should exams be open book?');
  const sheet = a.page.getByRole('dialog').filter({ hasText: 'open book' });
  await expect(sheet).toBeVisible({ timeout: 80_000 });
  await sheet.getByRole('button').first().click();
  await expect(sheet.getByText(/Your answer is in/)).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByText(/Nothing was shared/)).toHaveCount(0);
  await teammatesVote('open book');
  // the debate continues: the Chair's verdict lands in the group chat
  await expect.poll(verdicts, { timeout: 60_000 }).toBeGreaterThan(before);
  await a.ctx.close();
});

test('J38 a debate confirm can be declined with the second button without an error', async ({
  browser,
}) => {
  const tok = await apiLogin('s_ana');
  const a = await actor(browser, 's_ana');
  await a.page.goto('/squad/village');
  await expect(a.page.locator('[aria-label^="Council Hall"]').first()).toBeVisible({
    timeout: 30_000,
  });
  await startDebate(tok, 'should homework be graded?');
  const sheet = a.page.getByRole('dialog').filter({ hasText: 'graded' });
  await expect(sheet).toBeVisible({ timeout: 80_000 });
  await sheet.getByRole('button').nth(1).click();
  await expect(sheet.getByText(/Your answer is in/)).toBeVisible({ timeout: 15_000 });
  await a.ctx.close();
});

test('J38 an expired confirm task says it expired', async ({ browser }) => {
  const tok = await apiLogin('s_ana');
  const r = await api(tok, '/v1/confirms/task_does_not_exist', {
    method: 'POST',
    json: { yes: true },
  });
  expect(r.status).toBe(404);
  const g = await api(tok, '/v1/confirms/task_does_not_exist');
  expect(g.status).toBe(404);
  void browser;
});
