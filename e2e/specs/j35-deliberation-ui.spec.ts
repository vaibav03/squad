// J35: the deliberation surface (council board). Phase header, turn cards with semantic badges and reply-to, the ballot
// matrix, the pinned decision card (missing evidence, dissent, provenance, CTAs), portraits that open the agent panel seam,
// responsive layout at four viewports, keyboard semantics, contrast AA, Calm and reduced motion, and the emoji audit.
// Fixture mode: the council replay (`?replay=track4&board=1`) and the ask fixture (`?board=ask&boardspeed=instant`).
// Screenshots for review go to ~/Desktop/squad-demo/design-<name>.png (never into the repo).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { actor, expect, test } from '../lib/helpers';

const DESKTOP = path.join(os.homedir(), 'Desktop', 'squad-demo');
async function snap(page: Page, name: string): Promise<void> {
  try {
    fs.mkdirSync(DESKTOP, { recursive: true });
    await page.screenshot({ path: path.join(DESKTOP, `design-${name}.png`) });
  } catch {
    /* the desktop copy is a convenience */
  }
}
const board = (page: Page) => page.getByRole('dialog', { name: /Council|Ask council/ });
const VIEWPORTS = [
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '390x844', width: 390, height: 844 },
] as const;

async function openFinished(page: Page): Promise<Locator> {
  await page.goto('/squad/village?board=ask&boardspeed=instant');
  const dlg = board(page);
  await expect(dlg).toBeVisible({ timeout: 40_000 });
  await expect(dlg.getByTestId('dl-decision').getByTestId('dl-outcome')).toBeVisible({
    timeout: 30_000,
  });
  await expect(dlg.locator('.dl-phase[data-state="done"]')).toHaveCount(4);
  return dlg;
}

test('J35 the deliberation surface renders the phases, turn cards, ballot and the pinned decision', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  const { page } = a;
  const dlg = await openFinished(page);

  // (1) phase header: four phases, each with an icon and a word, the state in words
  const phases = dlg.getByRole('navigation', { name: 'Deliberation phases' });
  for (const w of ['Gather evidence', 'Debate', 'Vote', 'Synthesis'])
    await expect(phases).toContainText(w);
  await expect(phases.locator('.dl-phase svg')).toHaveCount(4);

  // (2) turn cards: portrait, speaker, semantic badge, reply-to, turn number, citation chips
  const turns = dlg.locator('article.dl-turn');
  expect(await turns.count()).toBeGreaterThan(8);
  const badges = await dlg.getByTestId('dl-turn-badge').allTextContents();
  for (const b of badges) expect(b.trim()).toMatch(/^(Proposal|Evidence|Challenge|Revision)$/);
  expect(new Set(badges.map((b) => b.trim())).size).toBeGreaterThanOrEqual(3);
  await expect(turns.first().locator('.dl-portrait')).toBeVisible();
  await expect(dlg.getByTestId('dl-reply-to').first()).toContainText(/Replying to/);
  await expect(turns.first()).toContainText(/Turn 1/);
  await expect(turns.locator('button', { hasText: /ch6\.pdf/ }).first()).toBeVisible();

  // (3) rankings are a ballot matrix, never chat lines
  const ballot = dlg.getByTestId('dl-ballot');
  await expect(ballot.getByRole('table')).toBeVisible();
  expect(await ballot.getByRole('columnheader').count()).toBeGreaterThanOrEqual(3);
  await expect(ballot.locator('.dl-rank').first()).toHaveText(/^\d$/);
  await expect(ballot).toContainText('Outlined: this voter ranked it differently');
  await expect(dlg.locator('article.dl-turn[data-kind="rank"]')).toHaveCount(0);

  // (4) the decision: outcome, consensus, confidence, provenance, dissent, missing evidence, CTAs
  const dec = dlg.getByTestId('dl-decision');
  await expect(dec.getByTestId('dl-outcome')).not.toBeEmpty();
  await expect(dec.getByTestId('dl-consensus')).toContainText(/Majority|Unanimous|Split/);
  await expect(dec.getByTestId('dl-confidence')).toContainText(/Sure|Fairly sure|Unsure/);
  await expect(dec.getByTestId('dl-provenance')).toContainText(/source/);
  await expect(dec.getByTestId('dl-provenance')).toContainText('Scripted fixture');
  await expect(dec.getByRole('group', { name: 'Dissent' })).toContainText(/disagreed/);
  await expect(dec.getByRole('group', { name: 'Missing evidence' })).toBeVisible();
  for (const n of ['Add proof text', 'Ask follow-up', 'Send to chat', 'Add to plan'])
    await expect(dec.getByRole('button', { name: n })).toBeVisible();
  // the decision is pinned in its own column (right of the feed) and is the dominant block: amber border, larger outcome text
  const decBox = (await dec.boundingBox())!;
  const feedBox = (await dlg.getByTestId('dl-feed').boundingBox())!;
  expect(decBox.x).toBeGreaterThanOrEqual(feedBox.x + feedBox.width - 1);
  expect(await dec.evaluate((el) => getComputedStyle(el).borderColor)).toMatch(/255, 200, 87/);
  const outFont = await dec
    .getByTestId('dl-outcome')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const turnFont = await turns
    .first()
    .locator('.dl-turn__text')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(outFont).toBeGreaterThan(turnFont * 1.3);
  await snap(page, 'board-1280x800-decision');

  // proof composer: opens from the CTA, Esc closes only the composer
  await dec.getByRole('button', { name: 'Add proof text' }).click();
  const proof = dec.getByTestId('dl-proof');
  await expect(proof).toBeVisible();
  await proof.getByRole('textbox').fill('Ch6 p.4: E0 = 1 + E0/2 + E1/2.');
  await expect(proof).toContainText(/characters left/);
  await snap(page, 'board-proof-composer');
  await page.keyboard.press('Escape');
  await expect(proof).toHaveCount(0);
  await expect(dlg).toBeVisible();
  await expect(dec.getByRole('button', { name: 'Add proof text' })).toBeFocused();

  // portraits are buttons that open the selected-agent panel seam (fallback: narrow the feed to that member)
  const events = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const got: string[] = [];
        window.addEventListener('squad:agent-panel-open', (e) =>
          got.push((e as CustomEvent).detail.agentId),
        );
        document
          .querySelector<HTMLElement>('[data-testid=dl-member] [data-testid=dl-portrait-btn]')!
          .click();
        setTimeout(() => resolve(got), 50);
      }),
  );
  expect(events).toHaveLength(1);
  expect(events[0]).toMatch(/^council:/);
  await expect(dlg.getByRole('button', { name: 'Clear filters' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Clear filters' }).click();

  // Ask follow-up drafts @cubbie plus the run id in the group chat composer
  await dec.getByRole('button', { name: 'Ask follow-up' }).click();
  await expect(dlg).toHaveCount(0);
  const composer = page.getByTestId('chat-composer-input');
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await expect(composer).toHaveValue(/@cubbie Follow-up on council run cn_/);
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});

for (const vp of VIEWPORTS) {
  test(`J35 responsive ${vp.name}: nothing overlaps, no sideways scroll, the decision stays reachable`, async ({
    browser,
  }) => {
    const a = await actor(browser, 's_ana', {
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: 'reduce',
    });
    const { page } = a;
    const dlg = await openFinished(page);
    await page.waitForTimeout(300);
    const panel = page.locator('.cb-panel');
    const pb = (await panel.boundingBox())!;
    expect(pb.x).toBeGreaterThanOrEqual(-1);
    expect(pb.y).toBeGreaterThanOrEqual(-1);
    expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width + 1);
    expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height + 1);
    // no horizontal scroll in the page or in any scroller inside the dialog
    const overflow = await page.evaluate(() => {
      const bad: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('document');
      document.querySelectorAll('.cb-panel *').forEach((el) => {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1)
          bad.push(`${el.className}`);
      });
      return bad;
    });
    expect(overflow).toEqual([]);
    // turn cards never overlap each other; the decision never overlaps the feed or the roster
    const boxes = await page.evaluate(() => {
      const r = (s: string) =>
        [...document.querySelectorAll<HTMLElement>(s)].map((e) => {
          const b = e.getBoundingClientRect();
          return { x: b.x, y: b.y, w: b.width, h: b.height };
        });
      return {
        turns: r('article.dl-turn'),
        members: r('[data-testid=dl-member]'),
        decision: r('[data-testid=dl-decision]'),
        feed: r('[data-testid=dl-feed]'),
        roster: r('[data-testid=dl-roster]'),
      };
    });
    const hit = (p: { x: number; y: number; w: number; h: number }, q: typeof p) =>
      p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1;
    const visibleTurns = boxes.turns.filter((t) => t.w > 0 && t.h > 0);
    for (let i = 1; i < visibleTurns.length; i++)
      expect(hit(visibleTurns[i - 1]!, visibleTurns[i]!)).toBe(false);
    for (let i = 1; i < boxes.members.length; i++)
      expect(hit(boxes.members[i - 1]!, boxes.members[i]!)).toBe(false);
    expect(hit(boxes.decision[0]!, boxes.feed[0]!)).toBe(false);
    expect(hit(boxes.decision[0]!, boxes.roster[0]!)).toBe(false);
    await snap(page, `board-${vp.name}`);
    // the decision is reachable: visible, or scrollable into view inside the dialog
    await dlg.getByTestId('dl-decision').scrollIntoViewIfNeeded();
    await expect(
      dlg.getByTestId('dl-decision').getByRole('button', { name: 'Add proof text' }),
    ).toBeVisible();
    await dlg.getByTestId('dl-ballot').scrollIntoViewIfNeeded();
    await expect(dlg.getByTestId('dl-ballot')).toBeVisible();
    await snap(page, `board-${vp.name}-scrolled`);
    expect(a.pageErrors).toEqual([]);
    await a.ctx.close();
  });
}

test('J35 keyboard: buttons are real buttons, Tab stays in the dialog, Esc closes', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  const dlg = await openFinished(page);
  await expect(dlg.getByRole('button', { name: 'Close' })).toBeFocused();
  // every interactive control is a native button, link, select or textarea (no role=button divs)
  const fake = await dlg.evaluate((el) =>
    [...el.querySelectorAll('[role=button],[onclick]')]
      .filter((n) => !/^(BUTTON|A|SELECT|TEXTAREA|INPUT|ARTICLE)$/.test(n.tagName))
      .map((n) => n.tagName + '.' + n.className),
  );
  expect(fake).toEqual([]);
  // Tab order: forward through the dialog and it wraps (never leaves it)
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const inside = await dlg.evaluate((el) => el.contains(document.activeElement));
    expect(inside).toBe(true);
    seen.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.tagName ??
          '',
      ),
    );
  }
  expect(new Set(seen).size).toBeGreaterThan(5);
  // arrow keys inside the feed
  await dlg.locator('article.dl-turn').first().focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-posinset'))).toBe(
    '2',
  );
  await page.keyboard.press('End');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-posinset'))).toBe(
    String(await dlg.locator('article.dl-turn').count()),
  );
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  await a.ctx.close();
});

test('J35 contrast AA: every text element in the board meets 4.5:1 (3:1 for large text)', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana', { reducedMotion: 'reduce' });
  const { page } = a;
  const dlg = await openFinished(page);
  await dlg.getByRole('button', { name: 'Add proof text' }).click();
  await page.waitForTimeout(300);
  const bad = await page.evaluate(() => {
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        // color(srgb r g b / a) from color-mix
        const k = c.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
        if (k)
          return [
            Math.round(+k[1]! * 255),
            Math.round(+k[2]! * 255),
            Math.round(+k[3]! * 255),
            k[4] === undefined ? 1 : +k[4],
          ];
        return [0, 0, 0, 0];
      }
      const p = m[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0]!, p[1]!, p[2]!, p[3] === undefined ? 1 : p[3]!];
    };
    const over = (top: RGBA, bottom: RGBA): RGBA => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2]
        .map((i) => (top[i]! * top[3] + bottom[i]! * bottom[3] * (1 - top[3])) / a)
        .concat(a) as RGBA;
    };
    const lum = (c: RGBA) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const ratio = (x: RGBA, y: RGBA) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p) as [number, number];
      return (hi + 0.05) / (lo + 0.05);
    };
    const base: RGBA = [13, 33, 66, 1]; // --cc-surface under the glass
    const bgOf = (el: Element): RGBA => {
      const stack: RGBA[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) stack.push(c);
        if (c[3] === 1) break;
      }
      let acc: RGBA = stack[stack.length - 1]!.slice() as RGBA;
      if (!acc || acc[3] < 1) acc = over(acc ?? [0, 0, 0, 0], base);
      for (let i = stack.length - 2; i >= 0; i--) acc = over(stack[i]!, acc);
      return acc;
    };
    const out: string[] = [];
    const root = document.querySelector('.cb-panel')!;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!(n.nodeValue ?? '').trim()) continue;
      const el = n.parentElement!;
      if (seen.has(el) || el.closest('.dl-sr,.cb-sr,script,style')) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) continue;
      const fg = parse(s.color);
      const bg = bgOf(el);
      const text = over(fg, bg);
      const size = parseFloat(s.fontSize);
      const large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700);
      const r = ratio(text, bg);
      if (r < (large ? 3 : 4.5) - 0.02)
        out.push(
          `${r.toFixed(2)} ${el.className || el.tagName} "${(n.nodeValue ?? '').trim().slice(0, 30)}"`,
        );
    }
    return out;
  });
  expect(bad, bad.join('\n')).toEqual([]);
  await a.ctx.close();
});

test('J35 motion: handoff lines focus in 160-240 ms ease-out; Calm and reduced motion are static', async ({
  browser,
}) => {
  // normal motion: the animation is on, within the budget, using the ease-out curve
  const m = await actor(browser, 's_ana', { reducedMotion: 'no-preference' });
  await m.page.goto('/squad/village?replay=track4&board=1');
  const dlg = board(m.page);
  await expect(dlg.getByTestId('dl-handoff').first()).toBeAttached({ timeout: 30_000 });
  const live = await dlg
    .getByTestId('dl-handoff')
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, dur: s.animationDuration, fn: s.animationTimingFunction };
    });
  expect(live.name).toBe('dl-draw');
  const ms = parseFloat(live.dur) * (live.dur.endsWith('ms') ? 1 : 1000);
  expect(ms).toBeGreaterThanOrEqual(160);
  expect(ms).toBeLessThanOrEqual(240);
  expect(live.fn).toMatch(/cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  await m.ctx.close();

  // prefers-reduced-motion and Calm: nothing animates, and the lines are drawn in full
  for (const mode of ['reduced', 'calm'] as const) {
    const a = await actor(browser, 's_ana', {
      reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference',
    });
    const { page } = a;
    await page.goto('/squad/village?replay=track4&board=1');
    const d = board(page);
    await expect(d.getByTestId('dl-decision').getByTestId('dl-outcome')).toBeVisible({
      timeout: 40_000,
    });
    if (mode === 'calm')
      await page.evaluate(() => (document.documentElement.dataset.calm = 'true'));
    await page.waitForTimeout(200);
    const anim = await page.evaluate(() =>
      [...document.querySelectorAll('.cb-panel *')]
        .map((el) => getComputedStyle(el))
        .filter((s) => s.animationName !== 'none' && !/^(0s|0ms)/.test(s.animationDuration))
        .map((s) => s.animationName),
    );
    expect(anim, `${mode} animations`).toEqual([]);
    // handoff lines come and go with the run: read all of them in one pass
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="dl-handoff"]')].map((el) => {
        const st = getComputedStyle(el);
        return { name: st.animationName, off: st.strokeDashoffset };
      }),
    );
    for (const o of lines) {
      expect(o.name).toBe('none');
      expect(parseFloat(o.off)).toBe(0);
    }
    await a.ctx.close();
  }
});

test('J35 emoji and dot audit of the board: no emoji or bare marker outside user content', async ({
  browser,
}) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  const dlg = await openFinished(page);
  await dlg.getByRole('button', { name: 'Add proof text' }).click();
  const hits = await page.evaluate(() => {
    const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
    const MARK = /^\s*[●•◆▲○◐◑◇■□▪▫★☆♥⚙✓✕≠≡→←↔]+\s*$|^\s*[●•◆▲○◐◑◇■□▪▫★☆♥⚙✓✕≠≡]\s/u;
    const out: string[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue ?? '';
      if (
        n.parentElement?.closest(
          '[data-user-content],[data-testid="chat-message-body"],script,style',
        )
      )
        continue;
      if (EMOJI.test(t) || MARK.test(t)) out.push(t.trim().slice(0, 40));
    }
    document.querySelectorAll('.cb-panel [aria-label],.cb-panel [title]').forEach((el) => {
      const t = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`;
      if (EMOJI.test(t)) out.push(t);
    });
    // coloured dots: tiny solid circles with no text and no children
    document.querySelectorAll('.cb-panel *').forEach((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (
        r.width > 0 &&
        r.width <= 12 &&
        r.height <= 12 &&
        /50%|999px/.test(s.borderRadius) &&
        s.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        !el.children.length &&
        !(el.textContent ?? '').trim()
      )
        out.push(`dot ${el.className}`);
    });
    return out;
  });
  expect(hits).toEqual([]);
  await a.ctx.close();
});
