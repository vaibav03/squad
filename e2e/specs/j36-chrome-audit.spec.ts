// J36: no decorative emoji or dot markers in product chrome, on every route and in every panel we can open in fixture mode.
// Emoji stays only in user-authored content: [data-user-content] and [data-testid=chat-message-body].
// Documented exceptions: <canvas>/<svg>/<script>/<style> content; ASCII separators (a middle dot between words) are fine,
// only a text node that is a bare marker glyph (or starts with one) fails; CSS dots are only flagged when a rendered
// element is a tiny (<=12px) solid 50%-radius circle with no text and no child (avatars, spinners, radios are larger or
// carry content/children). Screenshots are not taken here.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { WEB } from '../lib/env';
import { apiLogin } from '../lib/helpers';

const ROUTES = [
  '/squad',
  '/squad/setup',
  '/squad/village',
  '/squad/chat',
  '/squad/ledger',
  '/squad/trips',
  '/squad/courses',
  '/squad/members',
  '/squad/status',
  '/squad/connections',
  '/squad/personas',
  '/squad/new',
];
const FIXTURE_ROUTES = [
  '/squad/village?replay=track4&board=1',
  '/squad/village?replay=track4b&board=1',
  '/squad/village?replay=track4c&board=1',
];

interface Hit {
  kind: string;
  text: string;
  where: string;
}

async function audit(page: Page): Promise<Hit[]> {
  return page.evaluate(() => {
    const EMOJI = /\p{Extended_Pictographic}|️|\p{Regional_Indicator}/u;
    const BARE = /^\s*[●•◆▲○◐◑◇■□▪▫★☆♥⚙✓✕≠≡→←↔]+\s*$/u;
    const LEAD = /^\s*[●•◆▲○◐◑◇■□▪▫★☆♥⚙✓✕≠≡]\s/u;
    const USER = '[data-user-content],[data-testid="chat-message-body"]';
    const out: { kind: string; text: string; where: string }[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue ?? '';
      if (!t.trim()) continue;
      const el = n.parentElement;
      if (!el || el.closest(`${USER},script,style,canvas,svg`)) continue;
      const kind = EMOJI.test(t) ? 'emoji' : BARE.test(t) || LEAD.test(t) ? 'marker' : '';
      if (kind)
        out.push({ kind, text: t.trim().slice(0, 60), where: `${el.tagName}.${el.className}` });
    }
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (el.closest(`${USER},canvas,svg`)) continue;
      for (const pseudo of ['::before', '::after']) {
        const c = getComputedStyle(el, pseudo).content;
        if (
          (c && c !== 'none' && c !== 'normal' && EMOJI.test(c)) ||
          (c && BARE.test(c.replace(/^"|"$/g, '')))
        )
          out.push({
            kind: 'css-content',
            text: c,
            where: `${el.tagName}.${el.className}${pseudo}`,
          });
      }
      const r = (el as HTMLElement).getBoundingClientRect();
      if (
        r.width &&
        r.width <= 12 &&
        r.height <= 12 &&
        !el.children.length &&
        !(el.textContent ?? '').trim()
      ) {
        const s = getComputedStyle(el);
        const round =
          parseFloat(s.borderTopLeftRadius) >= r.width / 2 - 0.5 ||
          s.borderTopLeftRadius.includes('%');
        const solid =
          s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
        const decorative = el.getAttribute('aria-hidden') === 'true' || !el.getAttribute('role');
        if (
          round &&
          solid &&
          decorative &&
          (el as HTMLElement).tagName !== 'IMG' &&
          !el.closest('button,input,[role=switch],[role=radio],.sq-skeleton,.sq-spinner,.lv-spin')
        )
          out.push({ kind: 'dot', text: '', where: `${el.tagName}.${el.className}` });
      }
    }
    return out;
  });
}

async function fresh(browser: Browser, token: string) {
  const ctx = await browser.newContext({ baseURL: WEB, viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('squad.token', t);
    } catch {
      /* storage blocked */
    }
  }, token);
  return { ctx, page: await ctx.newPage() };
}

test.describe('j36 chrome has no decorative emoji or dot markers', () => {
  let token = '';
  test.beforeAll(async () => {
    token = await apiLogin('s_ana');
  });

  for (const path of [...ROUTES, ...FIXTURE_ROUTES]) {
    test(`route ${path}`, async ({ browser }) => {
      const { ctx, page } = await fresh(browser, token);
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(2500); // fixtures stream in
      expect(await audit(page), `chrome markers on ${path}`).toEqual([]);

      // open every dialog-ish panel we can find on this page and audit again
      const openers = page.locator(
        'button[aria-haspopup="dialog"], button:has-text("Council"), button:has-text("Plan"), button:has-text("More")',
      );
      const n = Math.min(await openers.count(), 6);
      for (let i = 0; i < n; i++) {
        const b = openers.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        await b.click({ timeout: 2000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        expect(await audit(page), `chrome markers after opening panel ${i} on ${path}`).toEqual([]);
        await page.keyboard.press('Escape');
      }
      await ctx.close();
    });
  }
});
