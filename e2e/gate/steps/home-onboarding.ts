// S0 Home cards + bootstrap, S1b phone link, S1c catalogue rows, V13 Home with a late hub.
// Owner: fix/home-onboarding-catalogue. Fixture = the gate's fixture world (fake upstreams, demo model); the real column
// runs the same web/hub assertions against the real hub (no fakes are involved in any of them), except S1b where the
// real iMessage delivery is BLOCKED until the bridge has a verified, allowlisted run.
import type { Page } from '@playwright/test';
import { HUB, WEB } from '../lib/config';
import { api } from '../lib/hub';
import type { Probe } from '../lib/types';
import type { StepDef } from '../lib/runner';
import type { GateCtx } from '../lib/ctx';
import { coldContext, desktopShot, offlineSightings, shapeHub } from '../../lib/home';

const P_HOME: Probe = {
  owner: 'fix/home-onboarding-catalogue',
  files: [
    { path: 'packages/web/src/pages/home/bootstrap.ts', contains: 'useHubReady' },
    { path: 'packages/web/src/pages/home/home-links.ts', contains: 'resolveHomeLinks' },
  ],
  why: 'Home resolves its cards from real state and waits on the hub bootstrap',
};
const P_PHONE: Probe = {
  owner: 'fix/home-onboarding-catalogue',
  files: [{ path: 'apps/hub/src/routes/phone.ts', contains: '/v1/me/phone/verify' }],
  why: 'POST /v1/me/phone/start|verify link a verified phone to the current account',
};
const P_CATALOGUE: Probe = {
  owner: 'fix/home-onboarding-catalogue',
  files: [{ path: 'packages/brain/test/catalog-golden.test.ts' }],
  why: 'complete catalogue rows (days/time) and the planner time-conflict check',
};

const NOT_FOUND = /Nothing at this address|We could not find that trip|Page not found/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rendersContent = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('main') ?? document.getElementById('root');
    const t = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return (t.length > 0 || !!el?.querySelector('canvas')) && !/\bloading\b/i.test(t);
  });

async function waitHome(page: Page) {
  await page.getByRole('heading', { name: 'Get set up' }).waitFor({ timeout: 40_000 });
  for (let i = 0; i < 80; i++) {
    const busy =
      (await page.getByText('Connecting to Squad...').count()) +
      (await page.getByText('Checking…').count());
    if (!busy) return;
    await sleep(250);
  }
}

async function homeCards(c: GateCtx, a: import('../lib/asserts').Asserts, label: string) {
  const { rhea } = c.world.users;
  const ctx = await coldContext(c.browser, rhea.token, WEB);
  const page = await ctx.newPage();
  try {
    await page.goto(`${WEB}/squad`);
    await waitHome(page);
    const links = await page.locator('.sq-home__link, .sq-home__row').evaluateAll((els) =>
      els.map((e) => ({
        href: e.getAttribute('href') ?? '',
        label: (e.querySelector('strong')?.textContent ?? '').trim(),
      })),
    );
    a.ok('Home shows the cards and checklist rows', links.length >= 8, `${links.length} links`);
    a.ok(
      'no card links to a hard-coded demo id',
      !JSON.stringify(links).includes('spring-break'),
      JSON.stringify(links.filter((l) => /trips/.test(l.href))),
    );
    const trip = links.find((l) => /\/squad\/trips/.test(l.href));
    a.ok(
      'the trip card is a real trip or the honest "Plan a trip"',
      !!trip &&
        (trip.label === 'Plan a trip'
          ? trip.href === '/squad/trips'
          : trip.href.startsWith('/squad/trips/')),
      JSON.stringify(trip),
    );
    await a.shot(page, `${label}-home`);
    await desktopShot(page, `${label}-cards`);
    for (const l of links) {
      await page.goto(`${WEB}/squad`);
      await waitHome(page);
      await page.locator(`a[href="${l.href}"]`).first().click();
      let ok = false;
      for (let i = 0; i < 60 && !ok; i++) {
        ok = await rendersContent(page);
        if (!ok) await sleep(300);
      }
      const body = await page.locator('body').innerText();
      a.ok(
        `"${l.label}" (${l.href}) renders and is not a not-found page`,
        ok && !NOT_FOUND.test(body),
      );
    }
  } finally {
    await ctx.close();
  }
}

/** Cold-loads Home with the hub unreachable for its first ~2 s (real hub behind it); returns every sighting of "offline". */
async function lateHubSightings(c: GateCtx, mode: 'late' | 'slow' | 'flap', loads: number) {
  const { rhea } = c.world.users;
  const seen: string[] = [];
  let shown = 0;
  for (let i = 0; i < loads; i++) {
    const ctx = await coldContext(c.browser, rhea.token, WEB);
    await shapeHub(ctx, mode, HUB);
    const page = await ctx.newPage();
    await page.goto(`${WEB}/squad`);
    try {
      await waitHome(page);
      seen.push(...(await offlineSightings(page)));
      shown++;
      if (i === 0) await desktopShot(page, `late-hub-${mode}`);
    } catch (e) {
      seen.push(`load ${i}: ${(e as Error).message.split('\n')[0]}`);
    }
    await ctx.close();
  }
  return { seen, shown };
}

export const S0: StepDef<GateCtx> = {
  id: 'S0',
  title: 'Home cards resolve and bootstrap without false offline',
  needs: [P_HOME],
  fixture: async (c, a) => {
    await homeCards(c, a, 's0');
    const { seen, shown } = await lateHubSightings(c, 'late', 3);
    a.eq('Home settled on every cold load with a late hub', shown, 3);
    a.eq('"offline" never appeared while the hub was reachable', seen.length, 0);
    if (seen.length) a.note(seen.slice(0, 2).join(' | '));
  },
  real: async (c, a) => {
    await homeCards(c, a, 's0-real');
  },
};

export const S1B: StepDef<GateCtx> = {
  id: 'S1b',
  title: 'phone link verified (dev code / iMessage allowlist)',
  needs: [P_PHONE],
  realNeeds: ['apple'],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const phone = '+1 415 555 0142';
    const before = (await api(rhea.token, '/v1/me')).json;
    a.eq('before linking the phone is not verified', before.phoneVerified, false);
    const start = (await api(rhea.token, '/v1/me/phone/start', { method: 'POST', json: { phone } }))
      .json;
    a.ok(
      'start answers with an honest delivery channel',
      start.ok === true && /dev|imessage/.test(start.delivery),
      JSON.stringify({ ...start, devCode: undefined }),
    );
    a.eq(
      'dev delivery is labelled, not pretended to be a text',
      start.deliveryLabel,
      'Code shown here (dev)',
    );
    a.ok(
      'a dev code is returned and labelled as such',
      /^\d{6}$/.test(start.devCode ?? '') && /dev/i.test(start.devCodeLabel ?? ''),
    );
    const wrong = await api(rhea.token, '/v1/me/phone/verify', {
      method: 'POST',
      json: {
        challengeId: start.challengeId,
        code: start.devCode === '000000' ? '111111' : '000000',
      },
    });
    a.ok(
      'a wrong code is refused',
      wrong.status >= 400 && wrong.status < 500,
      String(wrong.status),
    );
    a.eq(
      'still not verified after the wrong code',
      (await api(rhea.token, '/v1/me')).json.phoneVerified,
      false,
    );
    const okr = await api(rhea.token, '/v1/me/phone/verify', {
      method: 'POST',
      json: { challengeId: start.challengeId, code: start.devCode },
    });
    a.ok('the right code verifies', okr.status === 200, String(okr.status));
    const after = (await api(rhea.token, '/v1/me')).json;
    a.eq('GET /v1/me now says phoneVerified', after.phoneVerified, true);
    a.eq('the session was not swapped (same account)', after.user?.id, before.user?.id);
    const link = (await api(rhea.token, '/v1/imessage/link')).json;
    a.eq('the iMessage handle mapping is linked to this account', link.links?.length, 1);
    const page = c.actors.rhea?.page;
    if (page) {
      await page.goto(`${WEB}/squad`);
      await waitHome(page);
      const row = page.locator('li', { hasText: 'Link your phone' });
      a.ok('Home marks the phone done only after verification', /Done/.test(await row.innerText()));
      await a.shot(page, 'phone-done');
      await desktopShot(page, 'phone-done');
    }
  },
};

export const S1C: StepDef<GateCtx> = {
  id: 'S1c',
  title: 'catalogue rows complete',
  needs: [P_CATALOGUE],
  fixture: async (c, a) => {
    const { rhea } = c.world.users;
    const res = (await api(rhea.token, '/v1/library/catalogue')).json;
    const rows: Record<string, unknown>[] =
      res.catalogue?.courses ?? res.catalogue?.rows ?? res.catalogue ?? [];
    a.ok(
      'the planner catalogue has rows',
      Array.isArray(rows) && rows.length > 0,
      `${rows.length}`,
    );
    const incomplete = rows.filter(
      (r) =>
        !(r.id ?? r.code) || !r.title || !r.credits || !r.days || !r.start || !r.end || !r.offered,
    );
    a.eq('every row has code, title, credits, days, start, end and term', incomplete.length, 0);
    const courses = (await api(rhea.token, '/v1/library/courses')).json;
    const id = (courses.courses ?? [])[0]?.id as string | undefined;
    const page = c.actors.rhea?.page;
    if (page && id) {
      await page.goto(`${WEB}/squad/courses/${encodeURIComponent(id)}`);
      const panel = page.getByTestId('catalogue-panel');
      await panel.waitFor({ timeout: 30_000 });
      const cells = await panel
        .locator('tbody tr')
        .evaluateAll((trs) =>
          trs.map((tr) =>
            Array.from(tr.querySelectorAll('th,td')).map((x) => (x.textContent ?? '').trim()),
          ),
        );
      a.ok('the panel renders rows', cells.length > 0, `${cells.length}`);
      const blank = cells.filter((r) => r.some((t) => t === '' || t === 'undefined to undefined'));
      a.eq('no blank code/title/credits/days/time cell in the panel', blank.length, 0);
      a.eq(
        'no row is flagged Missing days/time',
        await panel.getByTestId('catalogue-gap').count(),
        0,
      );
      await a.shot(page, 'catalogue');
      await desktopShot(page, 'catalogue-rows');
    } else a.note('no course page to open; the API assertions above still ran');
  },
};

export const V13: StepDef<GateCtx> = {
  id: 'V13',
  title: 'Home late hub',
  needs: [P_HOME],
  fixture: async (c, a) => {
    for (const mode of ['late', 'slow', 'flap'] as const) {
      const { seen, shown } = await lateHubSightings(c, mode, 3);
      a.eq(`${mode} hub: Home settled on all 3 cold loads`, shown, 3);
      a.eq(`${mode} hub: no false "offline"`, seen.length, 0);
    }
  },
};
