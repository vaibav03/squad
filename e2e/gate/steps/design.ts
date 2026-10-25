// S0c: no decorative emoji or dot markers in product chrome (source audit + DOM audit of the main routes).
// S5c: the deliberation surface renders the ballot matrix and the pinned decision card on the council replay fixture.
// Specs with screenshots: e2e/specs/j36-chrome-audit.spec.ts and e2e/specs/j35-deliberation-ui.spec.ts.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { P } from '../lib/probes';
import { REPO } from '../lib/config';
import { webActor } from '../lib/hub';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';

export const S0c: StepDef<GateCtx> = {
  id: 'S0c',
  title: 'No decorative emoji or dot markers in product chrome',
  needs: [P.designSystem],
  label: 'fixture (source audit and DOM audit; emoji stays only in user-authored content)',
  fixture: async (c, a) => {
    let ok = true;
    try {
      execFileSync('node', [path.join(REPO, 'scripts/audit-chrome.mjs')], {
        cwd: REPO,
        stdio: 'pipe',
      });
    } catch (e) {
      ok = false;
      a.note(String((e as { stdout?: Buffer }).stdout ?? '').slice(0, 400));
    }
    a.ok('pnpm audit:chrome finds no violations in the source', ok);
    const act = await webActor(c.browser, c.world.users.rhea);
    const { page } = act;
    try {
      for (const url of ['/squad', '/squad/chat', '/squad/village?replay=track4&board=1']) {
        await page.goto(url);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1500);
        const hits = await page.evaluate(() => {
          const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
          const MARK =
            /^\s*[\u25CF\u2022\u25C6\u25B2\u25CB\u25D0\u25D1\u2699\u2713\u2715\u2260\u2261]+\s*$/u;
          const out: string[] = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const t = n.nodeValue ?? '';
            if (
              n.parentElement?.closest(
                '[data-user-content],[data-testid="chat-message-body"],script,style,canvas',
              )
            )
              continue;
            if (EMOJI.test(t) || MARK.test(t)) out.push(t.trim().slice(0, 30));
          }
          return out;
        });
        a.eq(`no emoji or bare marker on ${url}`, hits, []);
      }
    } finally {
      await act.ctx.close();
    }
  },
};

export const S5c: StepDef<GateCtx> = {
  id: 'S5c',
  title: 'The deliberation surface shows the ballot matrix and the pinned decision',
  needs: [P.board, P.deliberation],
  label: 'fixture (council replay, scripted, not Gemini)',
  fixture: async (c, a) => {
    const act = await webActor(c.browser, c.world.users.rhea);
    const { page } = act;
    try {
      await page.goto('/squad/village?board=ask&boardspeed=instant');
      const board = page.getByRole('dialog', { name: /Council|Ask council/ });
      await board.waitFor({ timeout: 30_000 });
      const dec = board.getByTestId('dl-decision');
      await dec.getByTestId('dl-outcome').waitFor({ timeout: 30_000 });
      a.eq('four phases, all done', await board.locator('.dl-phase[data-state="done"]').count(), 4);
      a.ok(
        'rankings are a ballot matrix',
        (await board.getByTestId('dl-ballot').getByRole('table').count()) === 1,
      );
      a.eq(
        'no ranking is a chat line',
        await board.locator('article.dl-turn[data-kind="rank"]').count(),
        0,
      );
      const badges = await board.getByTestId('dl-turn-badge').allTextContents();
      a.ok(
        'every turn has a semantic badge',
        badges.length > 0 &&
          badges.every((b) => /^(Proposal|Evidence|Challenge|Revision)$/.test(b.trim())),
      );
      a.ok('reply-to is shown', (await board.getByTestId('dl-reply-to').count()) > 0);
      a.ok(
        'decision shows consensus and confidence',
        /Majority|Unanimous|Split/.test(
          (await dec.getByTestId('dl-consensus').textContent()) ?? '',
        ) && /Sure|Unsure/.test((await dec.getByTestId('dl-confidence').textContent()) ?? ''),
      );
      a.ok(
        'decision shows provenance as Scripted fixture',
        /Scripted fixture/.test((await dec.getByTestId('dl-provenance').textContent()) ?? ''),
      );
      a.ok(
        'missing evidence block is present',
        (await dec.getByRole('group', { name: 'Missing evidence' }).count()) === 1,
      );
      for (const n of ['Add proof text', 'Ask follow-up', 'Send to chat', 'Add to plan'])
        a.ok(`CTA: ${n}`, (await dec.getByRole('button', { name: n }).count()) === 1);
      a.noRawIds('board', (await board.textContent()) ?? '');
    } finally {
      await act.ctx.close();
    }
  },
};
