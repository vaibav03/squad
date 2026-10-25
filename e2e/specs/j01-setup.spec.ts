import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_PDFS, ICS_DIR, STUDENTS, WEB, HUB } from '../lib/env';
import { actor, api, apiLogin, expect, NAMES, shot, test, note } from '../lib/helpers';

const J = 'j1-setup';

for (const id of STUDENTS) {
  test(`J1 sign in as ${NAMES[id]} through the sign-in screen`, async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: WEB });
    const page = await ctx.newPage();
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('/signin');
    await shot(page, J, `signin-${id}`);
    await page.getByRole('radio', { name: new RegExp(`^${NAMES[id]}`) }).click();
    await page.getByRole('button', { name: new RegExp(`as ${NAMES[id]}`) }).click();
    await page.waitForURL(/\/squad/);
    await expect(
      page.getByText(new RegExp(`Good (evening|morning|afternoon), ${NAMES[id]}`)),
    ).toBeVisible();
    const session = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('squad.session'))) ?? '{}',
    );
    expect(session.live, 'session should come from the real hub dev-login, not mock').toBe(true);
    const me = await (await api(session.token, '/v1/me')).json();
    expect(me.student.id).toBe(id);
    expect(errs).toEqual([]);
    await shot(page, J, `home-${id}`);
    await ctx.close();
  });
}

test('J1 setup: phone, PDFs, .ics, persona (Ana, through the UI)', async ({ browser }) => {
  const a = await actor(browser, 's_ana');
  const { page } = a;
  await page.goto('/squad/setup/phone');
  await page.getByLabel('Mobile number').fill('5550100101');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await shot(page, J, 'phone-code');
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/setup\/courses/);

  const pdfs = fs
    .readdirSync(FIXTURE_PDFS)
    .filter((f) => f.endsWith('.pdf'))
    .map((f) => path.join(FIXTURE_PDFS, f));
  expect(pdfs.length).toBeGreaterThanOrEqual(2);
  const up = page.waitForResponse(
    (r) => r.url().includes('/v1/squad/courses') && r.request().method() === 'POST',
  );
  await page.locator('input[type=file]').setInputFiles(pdfs);
  expect((await up).status()).toBe(202);
  await expect(page.getByLabel('Your files')).toBeVisible();
  await page.waitForTimeout(3000);
  await shot(page, J, 'courses-uploaded');
  const ready = await page.getByRole('button', { name: 'Continue' }).isEnabled();
  if (!ready) note('BUG-E2E: Continue stays disabled after a successful live upload');
  expect.soft(ready, 'E2E-001: Continue should enable once the hub accepted the PDFs').toBe(true);
  await page.goto('/squad/setup/calendar'); // continue past the defect so later steps are still exercised

  const ics = path.join(ICS_DIR, 's_ana.ics');
  let calPosts = 0;
  page.on('request', (r) => {
    if (r.url().includes('/v1/squad/calendar') && r.method() === 'POST') calPosts++;
  });
  await page.locator('input[type=file]').setInputFiles(ics);
  await expect(page.getByText(/We found \d+ busy blocks?/)).toBeVisible();
  await page.waitForTimeout(1500);
  expect
    .soft(
      calPosts,
      'E2E-002: an uploaded .ics must reach the hub (POST /v1/squad/calendar); the UI only parses it locally',
    )
    .toBeGreaterThan(0);
  await shot(page, J, 'calendar-uploaded');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(/setup\/persona/);
  await shot(page, J, 'persona-step');
  // pick the first persona-ish option
  const choice = page.getByRole('radio').first();
  await choice.click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForURL(/setup\/done/);
  await expect(page.getByText('You are all set')).toBeVisible();
  await shot(page, J, 'done');
  expect(a.pageErrors).toEqual([]);
  await a.ctx.close();
});

test('J1 chapters appear after ingest (hub courses + mastery)', async () => {
  const tok = await apiLogin('s_ana');
  let courses: { courseId: string; file: string; status: string }[] = [];
  await expect
    .poll(
      async () => {
        courses = (
          (await (await api(tok, '/v1/squad/courses')).json()) as { courses: typeof courses }
        ).courses;
        return courses.length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  note(`courses: ${JSON.stringify(courses).slice(0, 300)}`);
  const m = await api(tok, `/v1/mastery/${courses[0]!.courseId}`);
  const mastery = await m.json();
  note(`mastery ${m.status}: ${JSON.stringify(mastery).slice(0, 200)}`);
  expect(m.status).toBeLessThan(500);
});

test('J1 other students ingest + calendars through the API (needed by later journeys)', async () => {
  for (const id of STUDENTS.filter((s) => s !== 's_ana')) {
    const tok = await apiLogin(id);
    const fd = new FormData();
    const f = path.join(FIXTURE_PDFS, 'ch6-the-normal-distribution.pdf');
    fd.append(
      'file',
      new Blob([fs.readFileSync(f)], { type: 'application/pdf' }),
      'ch6-the-normal-distribution.pdf',
    );
    const r = await fetch(`${HUB}/v1/squad/courses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}` },
      body: fd,
    });
    expect(r.status, `${id} course upload`).toBe(202);
    const icsName = `${id}.ics`; // fixtures are named after the agent ids
    const cfd = new FormData();
    cfd.append(
      'file',
      new Blob([fs.readFileSync(path.join(ICS_DIR, icsName))], { type: 'text/calendar' }),
      `${id}.ics`,
    );
    const c = await fetch(`${HUB}/v1/squad/calendar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}` },
      body: cfd,
    });
    expect(c.status, `${id} calendar upload`).toBe(200);
  }
});
