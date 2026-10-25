import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../lib/env';
import { actor, apiLogin, expect, note, shot, test } from '../lib/helpers';
import { GROUP, needChat, openChat, say, waitBot, dump } from '../lib/chat';

test('J6 plan my next semester: outcome card with a plan that respects prerequisites', async ({
  browser,
}) => {
  await needChat();
  const a = await actor(browser, 's_dev');
  await openChat(a, GROUP);
  await say(a.page, '@cubbie plan my next semester');
  const m = await waitBot(a.token, GROUP, (x) => /Round table plan/i.test(x.text), 60_000);
  expect(m, 'a Round table plan message').toBeTruthy();
  note(dump(m));
  await expect(a.page.getByText(/Round table plan/i).first()).toBeVisible({ timeout: 20_000 });
  await shot(a.page, 'j6-semester', 'plan-in-chat');
  // prerequisites: every planned course has its prerequisites in the completed record or planned never before them
  const cat = JSON.parse(
    fs.readFileSync(path.join(REPO, 'packages/brain/fixtures/catalog/catalog.json'), 'utf8'),
  ) as { courses: { id: string; prereqs: string[]; credits: number }[] };
  const done = (
    JSON.parse(
      fs.readFileSync(
        path.join(REPO, 'packages/brain/fixtures/catalog/completed-sample.json'),
        'utf8',
      ),
    ) as { completed: string[] }
  ).completed;
  const planned = [...m!.text.matchAll(/^- (CSL \d+)/gm)].map((x) => x[1]!);
  expect(planned.length).toBeGreaterThan(0);
  for (const id of planned) {
    const c = cat.courses.find((x) => x.id === id);
    expect(c, `${id} exists in the catalog`).toBeTruthy();
    for (const p of c!.prereqs)
      expect(
        done.includes(p),
        `${id} needs ${p}, which is not completed (planned same term: ${planned.includes(p)})`,
      ).toBe(true);
  }
  expect(m!.text).toMatch(/Total: \d+ credits/);
  expect(m!.text).toMatch(/Dissent/i);
  await apiLogin('s_dev');
  await a.ctx.close();
});
