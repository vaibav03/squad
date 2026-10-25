import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_PDFS, REPO } from '../lib/env';
import { actor, api, apiLogin, expect, test, type Actor } from '../lib/helpers';

/*
 * J13 course library (happy path only). Journeys share one stack and one uploaded course,
 * so they run in file order on one worker: a -> b -> c -> d -> f -> e (f must run while the
 * course still exists; e deletes it).
 */
const J = 'j13-courses';
const SHOT_DIR = path.join(REPO, 'docs/design/shots/courses');
const SAMPLE_ID = 'demo';
const SAMPLE_TITLE = 'Introductory Statistics (OpenStax excerpt)';
const UPLOAD_PDF = path.join(FIXTURE_PDFS, 'ch2-descriptive-statistics.pdf');
const COURSE_TITLE = `E2E Stats ${Date.now().toString(36)}`;
const RENAMED = 'Renamed chapter (e2e)';

let ana: Actor | undefined;
let courseId = '';
let firstChapterId = '';

async function snap(a: Actor, name: string, w: number, h: number) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await a.page.setViewportSize({ width: w, height: h });
  await a.page.waitForTimeout(300);
  await a.page.screenshot({ path: path.join(SHOT_DIR, `${name}-${w}x${h}.png`) });
}

async function anaCtx(browser: import('@playwright/test').Browser): Promise<Actor> {
  if (!ana) ana = await actor(browser, 's_ana');
  return ana;
}

test('J13a open /squad/courses and see the OpenStax sample with CC BY and chapters', async ({ browser }) => {
  const a = await anaCtx(browser);
  await a.page.goto('/squad/courses');
  const card = a.page.getByTestId('course-card').filter({ hasText: SAMPLE_TITLE });
  await expect(card).toBeVisible();
  await expect(card.getByTestId('course-attribution')).toContainText('CC BY 4.0');
  await expect(card.getByTestId('course-attribution')).toContainText('OpenStax');
  await snap(a, 'j13a-library', 1280, 800);

  await a.page.goto(`/squad/courses/${SAMPLE_ID}`);
  await expect(a.page.getByTestId('course-title')).toContainText(SAMPLE_TITLE);
  await expect(a.page.getByTestId('course-attribution').first()).toContainText('CC BY 4.0');
  const chapters = a.page.getByTestId('chapter-item');
  await expect(chapters.first()).toBeVisible();
  expect(await chapters.count()).toBeGreaterThanOrEqual(3);
  await snap(a, 'j13a-sample-detail', 1280, 800);
  expect(a.pageErrors, 'no uncaught page errors').toEqual([]);
});

test('J13b upload a PDF through the dropzone, see ingest progress, then chapters', async ({ browser }) => {
  const a = await anaCtx(browser);
  await a.page.goto('/squad/courses');
  await a.page.getByTestId('new-course').click();
  await a.page.getByLabel('Course title').fill(COURSE_TITLE);
  await a.page.getByTestId('create-course-submit').click();
  await a.page.waitForURL(/\/squad\/courses\/[^/]+$/);
  courseId = decodeURIComponent(new URL(a.page.url()).pathname.split('/').pop()!);
  expect(courseId).toMatch(/^c_/);

  await expect(a.page.getByTestId('dropzone')).toBeVisible();
  const upload = a.page.waitForResponse(
    (r) => r.url().includes(`/v1/library/courses/${courseId}/files`) && r.request().method() === 'POST',
  );
  await a.page.getByTestId('file-input').setInputFiles(UPLOAD_PDF);
  expect((await upload).status()).toBe(202);

  const row = a.page.getByTestId('file-row').filter({ hasText: 'ch2-descriptive-statistics.pdf' });
  await expect(row).toBeVisible();
  await expect(row.getByTestId('file-status')).toBeVisible();
  await snap(a, 'j13b-ingesting', 1280, 800);

  // Ingest reaches ready (the stack runs the real parser on the fixture).
  await expect(row.getByTestId('file-status')).toHaveAttribute('data-status', 'ready', { timeout: 90_000 });
  await expect(a.page.getByTestId('chapter-item').first()).toBeVisible({ timeout: 15_000 });
  firstChapterId = (await a.page.getByTestId('chapter-item').first().getAttribute('data-chapter-id')) ?? '';
  expect(firstChapterId).toBeTruthy();
  await snap(a, 'j13b-ready-chapters', 1280, 800);
});

test('J13c open the chapter editor and rename a chapter', async ({ browser }) => {
  const a = await anaCtx(browser);
  await a.page.goto(`/squad/courses/${courseId}`);
  const item = a.page.locator(`[data-testid="chapter-item"][data-chapter-id="${firstChapterId}"]`);
  await expect(item).toBeVisible();
  await item.getByTestId('chapter-rename').click();
  const input = item.getByTestId('chapter-title-input');
  await expect(input).toBeVisible();
  await input.fill(RENAMED);
  await item.getByRole('button', { name: 'Save' }).click();
  await expect(item.getByTestId('chapter-title')).toHaveText(RENAMED);
  await snap(a, 'j13c-renamed', 1280, 800);

  // Persisted on the hub, not just in the page.
  const token = await apiLogin('s_ana');
  const detail = await (await api(token, `/v1/library/courses/${courseId}`)).json();
  expect(detail.chapters.map((c: { title: string }) => c.title)).toContain(RENAMED);
});

test('J13d open a chapter source in the source viewer', async ({ browser }) => {
  const a = await anaCtx(browser);
  await a.page.goto(`/squad/courses/${courseId}`);
  const item = a.page.locator(`[data-testid="chapter-item"][data-chapter-id="${firstChapterId}"]`);
  await item.getByTestId('chapter-open').click();
  const sheet = a.page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.sq-source__text, .sq-source__line').first()).toBeVisible({ timeout: 15_000 });
  await snap(a, 'j13d-source-viewer', 1280, 800);
  await a.page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Quote highlight and copy-quote, verified at the API the viewer calls (no in-app surface
  // renders a citation with a quote on this page yet, see docs/qa/E2E-BUGS-courses.md).
  const token = await apiLogin('s_ana');
  const q = encodeURIComponent('mean and average');
  const r = await api(
    token,
    `/v1/library/source?file=ch2-descriptive-statistics.pdf&page=1&quote=${q}&courseId=${courseId}`,
  );
  expect(r.status).toBe(200);
  const body = await r.json();
  expect(body.ok).toBe(true);
  expect(body.quoteVerified).toBe(true);
  expect(body.lines.some((l: { hit: boolean }) => l.hit)).toBe(true);
});

test('J13f a second student cannot GET the first student private course (404)', async () => {
  const token = await apiLogin('s_ben');
  const r = await api(token, `/v1/library/courses/${courseId}`);
  expect(r.status).toBe(404);
  expect((await r.json()).error.code).toBe('not_found');

  const list = await (await api(token, '/v1/library/courses')).json();
  expect(list.courses.map((c: { id: string }) => c.id)).not.toContain(courseId);
});

test('J13e delete the uploaded course through the confirm sheet', async ({ browser }) => {
  const a = await anaCtx(browser);
  await a.page.goto(`/squad/courses/${courseId}`);
  await a.page.getByTestId('delete-course').click();
  const confirm = a.page.getByTestId('delete-confirm');
  await expect(a.page.getByTestId('delete-summary')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await a.page.getByTestId('delete-title-input').fill(COURSE_TITLE);
  await expect(confirm).toBeEnabled();
  await snap(a, 'j13e-confirm-sheet', 1280, 800);
  await confirm.click();

  await a.page.waitForURL(/\/squad\/courses\/?$/);
  await expect(a.page.getByTestId('course-card').filter({ hasText: COURSE_TITLE })).toHaveCount(0);

  const token = await apiLogin('s_ana');
  const gone = await api(token, `/v1/library/courses/${courseId}`);
  expect(gone.status).toBe(404);
  await a.ctx.close();
  ana = undefined;
});

test('J13 mobile pass (390x844): library and sample detail', async ({ browser }) => {
  const a = await actor(browser, 's_ana', { viewport: { width: 390, height: 844 } });
  await a.page.goto('/squad/courses');
  await expect(a.page.getByTestId('course-card').filter({ hasText: SAMPLE_TITLE })).toBeVisible();
  await snap(a, 'j13-library-mobile', 390, 844);
  const overflow = await a.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'no horizontal page scroll at 390px').toBeLessThanOrEqual(0);

  await a.page.goto(`/squad/courses/${SAMPLE_ID}`);
  await expect(a.page.getByTestId('chapter-item').first()).toBeVisible();
  await snap(a, 'j13-sample-detail-mobile', 390, 844);
  await a.ctx.close();
});
