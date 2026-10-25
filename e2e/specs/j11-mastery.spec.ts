import { actor, expect, shot, test } from '../lib/helpers';

// J11: mastery page. Pips carry words, never numbers. Under 3 squad members the squad column is hidden
// and the page says why (the hub omits squadAvg).
const J = 'rooms';

test('J11 mastery shows pips with words and no squad numbers under 3 members', async ({ browser }) => {
  for (const vp of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const ana = await actor(browser, 's_ana', { viewport: vp });
    try {
      await ana.page.goto('/squad/mastery');
      await expect(ana.page.locator('.lv-legend'), 'J11: legend renders').toBeVisible({ timeout: 30_000 });

      const legend = ana.page.locator('.lv-legend li');
      await expect(legend, 'J11: four levels in the legend').toHaveCount(4);
      for (let i = 0; i < 4; i++) {
        const li = legend.nth(i);
        await expect(li.locator('.lv-mp'), 'J11: each legend level has a pip').toHaveCount(1);
        const word = (await li.innerText()).trim();
        expect(word, 'J11: each legend level has a word, not a number').toMatch(/^[A-Za-z ]+$/);
      }
      await expect(legend).toHaveText([/Not started/, /Learning/, /Getting there/, /Solid/]);

      // Under 3 members: no squad column, and the page explains it.
      await expect(ana.page.getByRole('note').filter({ hasText: 'Squad averages appear once three or more people have joined' })).toBeVisible();
      await expect(ana.page.getByRole('columnheader', { name: 'Squad average' }), 'J11: no squad column under 3 members').toHaveCount(0);

      // Concept rows (if the course has any): every pip has a word beside it.
      const words = ana.page.locator('.lv-grid__word');
      const n = await words.count();
      for (let i = 0; i < n; i++) expect(await words.nth(i).innerText(), 'J11: concept cell has a word').toMatch(/[A-Za-z]/);

      await shot(ana.page, J, `mastery-${vp.width}`);
      expect(ana.pageErrors, 'J11: no uncaught page errors').toEqual([]);
    } finally {
      await ana.ctx.close();
    }
  }
});
