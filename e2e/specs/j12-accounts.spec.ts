// J12: accounts and squads (sign up, create, invite, join, switch, sign out, isolation).
// Happy paths only. Runs serially: each journey builds on the state of the one before.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { HUB, WEB } from '../lib/env';
import { shot } from '../lib/helpers';

const stamp = Date.now().toString(36);
const J = 'accounts';

const maya = { name: 'Maya Chen', email: `maya.${stamp}@example.com` };
const noah = { name: 'Noah Reyes', email: `noah.${stamp}@example.com` };
const riley = { name: 'Riley Park', email: `riley.${stamp}@example.com` };
const squadOne = { name: `Study Group ${stamp}`, course: 'CS 101' };
const squadTwo = { name: `Second Group ${stamp}` };

let ctxA: BrowserContext;
let pageA: Page;
let ctxB: BrowserContext;
let pageB: Page;
let inviteLink = '';
let squadOneId = '';

/** Types a 6 digit code into the OTP boxes (keystrokes, so focus moves box to box). */
async function typeCode(page: Page, code: string) {
  await page.getByLabel(/digit 1 of 6/).focus();
  await page.keyboard.type(code, { delay: 40 });
}

/** Starts a challenge from the contact step and returns the devCode the hub sent back. */
async function sendCode(page: Page, email: string): Promise<string> {
  await page.getByRole('radio', { name: 'Email' }).click();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  const started = page.waitForResponse((r) => r.url().endsWith('/v1/auth/start') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Send code' }).click();
  const body = (await (await started).json()) as { devCode?: string };
  expect(body.devCode, 'hub returns devCode when HUB_DEV_LOGIN=1').toMatch(/^\d{6}$/);
  await expect(page.getByText(/Dev only: code/)).toContainText(body.devCode!);
  return body.devCode!;
}

/** Runs the welcome flow from the name step to a verified session. */
async function signUp(page: Page, who: { name: string; email: string }) {
  await page.goto('/welcome');
  await expect(page.getByRole('heading', { name: 'What should your squad call you?' })).toBeVisible();
  await page.getByLabel('Your name').fill(who.name);
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = await sendCode(page, who.email);
  await typeCode(page, code);
}

test.describe.serial('accounts journeys', () => {
  test('J12a sign up at /welcome with name and email, verify the devCode, land signed in', async ({ browser }) => {
    ctxA = await browser.newContext({ baseURL: WEB, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await ctxA.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: WEB });
    pageA = await ctxA.newPage();
    await pageA.goto('/welcome');
    await expect(pageA.getByRole('heading', { name: 'What should your squad call you?' })).toBeVisible();
    await shot(pageA, J, 'j12a-01-welcome-name');
    await pageA.getByLabel('Your name').fill(maya.name);
    await pageA.getByRole('button', { name: 'Continue' }).click();
    const code = await sendCode(pageA, maya.email);
    await shot(pageA, J, 'j12a-02-code-entry');
    await typeCode(pageA, code);

    await expect(pageA).toHaveURL(/\/welcome\/choose/);
    await expect(pageA.getByRole('link', { name: /Create a squad/ })).toBeVisible();
    await shot(pageA, J, 'j12a-03-signed-in-choose');

    const me = await ctxA.request.get(`${HUB}/v1/me`);
    expect(me.status()).toBe(200);
    expect(((await me.json()) as { user?: { name: string } }).user?.name).toBe(maya.name);
  });

  test('J12b create a squad at /squad/new and copy the invite link', async () => {
    await pageA.goto('/squad/new');
    await pageA.getByRole('textbox', { name: 'Squad name' }).fill(squadOne.name);
    await pageA.getByRole('textbox', { name: 'Course' }).fill(squadOne.course);
    await pageA.getByRole('button', { name: 'Create squad' }).click();

    await expect(pageA.getByRole('heading', { name: 'Invite your classmates' })).toBeVisible();
    await shot(pageA, J, 'j12b-01-invite-card');
    await pageA.getByRole('button', { name: 'Copy link' }).click();
    await expect(pageA.getByRole('button', { name: 'Copied' })).toBeVisible();

    inviteLink = await pageA.evaluate(() => navigator.clipboard.readText());
    expect(inviteLink).toMatch(/\/join\/[A-Z0-9]{4}-[A-Z0-9]{4}/);

    const me = (await (await ctxA.request.get(`${HUB}/v1/me`)).json()) as {
      activeSquadId: string | null;
      squads: { id: string; name: string }[];
    };
    squadOneId = me.activeSquadId ?? '';
    expect(squadOneId).not.toBe('');
    expect(me.squads.map((s) => s.name)).toContain(squadOne.name);
  });

  test('J12c second student opens the invite, signs up, joins, and both show on /squad/members', async ({ browser }) => {
    ctxB = await browser.newContext({ baseURL: WEB, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    pageB = await ctxB.newPage();
    await pageB.goto(new URL(inviteLink).pathname);
    await expect(pageB.getByRole('heading', { name: squadOne.name })).toBeVisible();
    await shot(pageB, J, 'j12c-01-invite-preview');
    await pageB.getByRole('button', { name: 'Sign in to join' }).click();
    await expect(pageB).toHaveURL(/\/welcome\?next=/);

    await signUp(pageB, noah);
    // The welcome flow returns to the invite it was opened from.
    await pageB.getByRole('button', { name: `Join ${squadOne.name}` }).click();
    // Joining keeps the invite URL and swaps to the joined state, with a link to the members list.
    await expect(pageB.getByText('It is now your active squad.')).toBeVisible();
    await expect(pageB.getByRole('link', { name: 'See who is here' })).toBeVisible();

    await pageB.goto('/squad/members');
    await expect(pageB.getByText(maya.name, { exact: false })).toBeVisible();
    await expect(pageB.getByText(noah.name, { exact: false })).toBeVisible();
    await shot(pageB, J, 'j12c-02-members-student-view');

    await pageA.goto('/squad/members');
    await expect(pageA.getByText(noah.name, { exact: false })).toBeVisible();
    await shot(pageA, J, 'j12c-03-members-owner-view');
  });

  test('J12d switch squads from the account sheet, sign out, sign back in', async () => {
    // Maya makes a second squad so there is something to switch between.
    await pageA.goto('/squad/new');
    await pageA.getByRole('textbox', { name: 'Squad name' }).fill(squadTwo.name);
    await pageA.getByRole('button', { name: 'Create squad' }).click();
    await expect(pageA.getByRole('heading', { name: 'Invite your classmates' })).toBeVisible();
    await pageA.getByRole('button', { name: 'Go to my squad' }).click();
    await expect(pageA).toHaveURL(/\/squad/);

    await pageA.getByRole('button', { name: `Account menu for ${maya.name}` }).click();
    const first = pageA.getByRole('radio', { name: new RegExp(squadOne.name) });
    await expect(first).toBeVisible();
    // A successful switch closes the sheet, so check the server's active squad rather than the radio.
    const activated = pageA.waitForResponse((r) => /\/v1\/squads\/[^/]+\/activate$/.test(r.url()) && r.request().method() === 'POST');
    await first.click();
    expect((await activated).status()).toBe(200);
    await expect
      .poll(async () => ((await (await ctxA.request.get(`${HUB}/v1/me`)).json()) as { activeSquadId: string }).activeSquadId)
      .toBe(squadOneId);
    await expect(pageA.getByRole('radio', { name: new RegExp(squadOne.name) })).toBeHidden();
    // The host remounts pages on a squad change: the shell must come back on its own.
    await expect(pageA.getByRole('navigation', { name: 'Main' }).first()).toBeVisible({ timeout: 10_000 });
    await shot(pageA, J, 'j12d-01-switched-squad');

    await pageA.getByRole('button', { name: `Account menu for ${maya.name}` }).click();
    await pageA.getByRole('button', { name: 'Sign out' }).click();
    await expect(pageA).toHaveURL(/\/welcome/);
    expect((await ctxA.request.get(`${HUB}/v1/me`)).status()).toBe(401);

    // Sign back in with the same email. The existing account skips the name.
    await pageA.getByRole('button', { name: 'I already have an account' }).click();
    const code = await sendCode(pageA, maya.email);
    await typeCode(pageA, code);

    await expect(pageA).toHaveURL(/\/squad/);
    await pageA.getByRole('button', { name: `Account menu for ${maya.name}` }).click();
    await expect(pageA.getByRole('radio', { name: new RegExp(squadOne.name) })).toBeVisible();
    await expect(pageA.getByRole('radio', { name: new RegExp(squadTwo.name) })).toBeVisible();
    await shot(pageA, J, 'j12d-02-signed-back-in');
    await pageA.keyboard.press('Escape');
  });

  test('J12e squad isolation: a student in another squad cannot read squad one', async ({ browser }) => {
    const ctxC = await browser.newContext({ baseURL: WEB });
    const pageC = await ctxC.newPage();
    await signUp(pageC, riley);
    await expect(pageC).toHaveURL(/\/welcome\/choose/);

    // Riley owns her own squad. Calls below use her session cookie.
    const created = await ctxC.request.post(`${HUB}/v1/squads`, { data: { name: `Riley Own ${stamp}` } });
    expect(created.status()).toBe(201);

    // Positive control: Maya is a member of squad one, so she can read it.
    const control = await ctxA.request.get(`${HUB}/v1/squads/${squadOneId}`);
    expect(control.status()).toBe(200);

    // Riley asks for squad one directly: 404 (existence is not leaked to non-members).
    const readSquad = await ctxC.request.get(`${HUB}/v1/squads/${squadOneId}`);
    expect([403, 404]).toContain(readSquad.status());

    // The ledger, scoped to squad one with the override header, is refused for a non-member.
    const ledger = await ctxC.request.get(`${HUB}/v1/ledger/e2e-probe`, {
      headers: { 'x-squad-id': squadOneId },
    });
    expect([403, 404]).toContain(ledger.status());
    await ctxC.close();
  });

  test('J12f phone-width pass at 390x844 for the account screens', async ({ browser }) => {
    const ctxM = await browser.newContext({
      baseURL: WEB,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'reduce',
    });
    const pageM = await ctxM.newPage();
    await pageM.goto('/welcome');
    await expect(pageM.getByRole('heading', { name: 'What should your squad call you?' })).toBeVisible();
    await shot(pageM, J, 'j12f-01-welcome-390');
    await ctxM.close();

    await pageA.setViewportSize({ width: 390, height: 844 });
    for (const [path, step] of [
      ['/squad/members', 'j12f-02-members-390'],
      ['/squad/new', 'j12f-03-create-390'],
    ] as const) {
      await pageA.goto(path);
      await pageA.waitForLoadState('networkidle');
      const overflow = await pageA.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `${path} has no horizontal page scroll at 390px`).toBeLessThanOrEqual(0);
      await shot(pageA, J, step);
    }
    await pageA.setViewportSize({ width: 1280, height: 800 });
  });
});
