import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_DIR, buildTextPdf } from '@squad/brain';
import type { RunningHub } from '../../src/server';
import { boot, login, openSse, post } from '../helpers';

let hub: RunningHub;
let url: string;
let ana: string; // owner
let ben: string; // same squad
let zed: string; // other squad

const H = (t: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${t}`,
  ...extra,
});
const J = (t: string) => H(t, { 'content-type': 'application/json' });
async function call(method: string, path: string, t: string | null, body?: unknown) {
  const r = await fetch(url + path, {
    method,
    headers: t ? (body === undefined ? H(t) : J(t)) : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* binary */
  }
  return { status: r.status, json: json as any, text };
}
async function upload(
  t: string,
  courseId: string,
  name: string,
  bytes: Uint8Array | string,
  kind?: string,
) {
  const form = new FormData();
  form.set('file', new File([typeof bytes === 'string' ? bytes : Buffer.from(bytes)], name));
  if (kind) form.set('kind', kind);
  const r = await fetch(`${url}/v1/library/courses/${courseId}/files`, {
    method: 'POST',
    headers: H(t),
    body: form,
  });
  return { status: r.status, json: (await r.json()) as any };
}
async function ready(t: string, fileId: string) {
  for (let i = 0; i < 200; i++) {
    const r = await call('GET', `/v1/library/files/${fileId}`, t);
    if (r.json.status === 'ready' || r.json.status === 'failed') return r.json;
    await new Promise((x) => setTimeout(x, 50));
  }
  throw new Error('ingest did not finish');
}

const SECRET = 'The moonlit heron eats quietly at dawn';
const NOTES = `Opening words here.\n${SECRET}.\nClosing words there.\n`;

beforeAll(async () => {
  hub = await boot();
  url = hub.url;
  hub.deps.directory.upsertStudent({
    id: 's_zed',
    name: 'Zed',
    handle: 'zed@demo.test',
    personaId: 'persona_zed',
  });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  ana = await login(url, 's_ana');
  ben = await login(url, 's_ben');
  zed = await login(url, 's_zed');
});
afterAll(async () => {
  await hub.stop();
});

describe('course library', () => {
  let courseId = '';
  let fileId = '';

  it('requires a viewer token', async () => {
    expect((await call('GET', '/v1/library/courses', null)).status).toBe(401);
  });

  it('lists the attributed, read-only sample for everyone', async () => {
    for (const t of [ana, zed]) {
      const r = await call('GET', '/v1/library/courses', t);
      expect(r.status).toBe(200);
      expect(r.json.limits).toMatchObject({ maxFileBytes: 25 * 1024 * 1024, maxPagesPerFile: 400 });
      const demo = r.json.courses.find((c: any) => c.id === 'demo');
      expect(demo).toMatchObject({
        role: 'public',
        sample: true,
        visibility: 'public',
        attribution: 'Introductory Statistics 2e, OpenStax, CC BY 4.0 (openstax.org)',
        chapterCount: 4,
      });
    }
    expect((await call('DELETE', '/v1/library/courses/demo', ana, { confirm: true })).status).toBe(
      403,
    );
    expect((await call('PATCH', '/v1/library/courses/demo', ana, { title: 'x' })).status).toBe(403);
    const d = await call('GET', '/v1/library/courses/demo', zed);
    expect(d.json).toMatchObject({ canEdit: false });
    expect(d.json.policy.lines.length).toBeGreaterThan(2);
  });

  it('creates a course, uploads text, and reports ingest progress on SSE and on the file row', async () => {
    const created = await call('POST', '/v1/library/courses', ana, { title: 'My Stats' });
    expect(created.status).toBe(201);
    courseId = created.json.id;
    expect(courseId).toMatch(/^c_[A-Za-z0-9_-]{22}$/);
    expect(created.json).toMatchObject({ role: 'owner', visibility: 'private', status: 'empty' });

    const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, ana);
    const sse = await openSse(url, { st: body.st });
    const up = await upload(ana, courseId, 'notes.txt', NOTES);
    expect(up.status).toBe(202);
    expect(up.json.status).toBe('queued');
    fileId = up.json.fileId;
    expect(fileId).toMatch(/^f_[A-Za-z0-9_-]{22}$/);

    const row = await ready(ana, fileId);
    expect(row).toMatchObject({
      status: 'ready',
      pct: 100,
      pages: 1,
      name: 'notes.txt',
      kind: 'material',
    });
    expect(row.sha256).toHaveLength(12);
    await sse.waitFor((f) =>
      f.some((x) => x.event === 'x.ingest.progress' && x.data?.includes('"ready"')),
    );
    const seen = sse.frames
      .filter((f) => f.event === 'x.ingest.progress')
      .map((f) => JSON.parse(f.data!).status);
    expect(seen).toEqual(expect.arrayContaining(['queued', 'parsing', 'embedding', 'ready']));
    sse.stop();

    const d = await call('GET', `/v1/library/courses/${courseId}`, ana);
    expect(d.json).toMatchObject({
      status: 'ready',
      fileCount: 1,
      chapterCount: 1,
      pageCount: 1,
      canEdit: true,
    });
  });

  it('uploads a generated PDF; rejects duplicates, unsafe, oversize and wrong types', async () => {
    const pdf = buildTextPdf([
      'Z scores standardise values across datasets.',
      'Second page of the PDF here.',
    ]);
    const up = await upload(ana, courseId, 'ch6.pdf', pdf);
    expect(up.status).toBe(202);
    expect(await ready(ana, up.json.fileId)).toMatchObject({ status: 'ready', pages: 2 });

    const dup = await upload(ana, courseId, 'copy.pdf', pdf);
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ error: { code: 'duplicate' }, fileId: up.json.fileId });

    const evil = buildTextPdf(['hello hello'], '/OpenAction << /S /JavaScript /JS (x) >>');
    const u = await upload(ana, courseId, 'evil.pdf', evil);
    expect(u.status).toBe(422);
    expect(u.json.error.code).toBe('unsafe_pdf');

    const big = await upload(ana, courseId, 'big.txt', new Uint8Array(26 * 1024 * 1024).fill(97));
    expect(big.status).toBe(413);
    expect(big.json.error.code).toBe('too_large');

    const pptx = await upload(ana, courseId, 'deck.pptx', new Uint8Array([0x50, 0x4b, 3, 4, 1, 2]));
    expect(pptx.status).toBe(415);
    expect(pptx.json.error.code).toBe('unsupported_type');
    const renamed = await upload(ana, courseId, 'fake.pdf', 'just text pretending');
    expect(renamed.json.error.code).toBe('unsupported_type');
    const d = await call('GET', `/v1/library/courses/${courseId}`, ana);
    expect(d.json.files).toHaveLength(2);
  });

  it('serves one verified excerpt to the owner and the raw file', async () => {
    const q = `file=notes.txt&page=1&quote=${encodeURIComponent(SECRET)}`;
    const r = await call('GET', `/v1/library/source?${q}`, ana);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      ok: true,
      courseId,
      fileId,
      quoteVerified: true,
      imageUrl: null,
    });
    expect(r.json.lines.filter((l: any) => l.hit).map((l: any) => l.text)).toEqual([`${SECRET}.`]);
    expect(r.json.openUrl).toBe(`/v1/library/files/${fileId}/raw#page=1`);
    const raw = await fetch(`${url}/v1/library/files/${fileId}/raw`, { headers: H(ana) });
    expect(raw.status).toBe(200);
    expect(await raw.text()).toBe(NOTES);
    expect(raw.headers.get('content-disposition')).toBe('inline');
    const miss = await call(
      'GET',
      `/v1/library/source?file=notes.txt&page=9&courseId=${courseId}`,
      ana,
    );
    expect(miss.json).toEqual({ ok: false, reason: 'page_missing' });
  });

  it('cross-student isolation: private material is invisible to squadmates and other squads', async () => {
    const q = `file=notes.txt&page=1&quote=${encodeURIComponent(SECRET)}`;
    const nf = { ok: false, reason: 'not_found' };
    const gone = await call('GET', '/v1/library/source?file=nope.txt&page=1', zed);
    for (const t of [ben, zed]) {
      const list = await call('GET', '/v1/library/courses', t);
      expect(list.json.courses.map((c: any) => c.id)).toEqual(['demo']);
      expect((await call('GET', `/v1/library/courses/${courseId}`, t)).status).toBe(404);
      const s = await call('GET', `/v1/library/source?${q}`, t);
      expect(s.status).toBe(404);
      expect(s.json).toEqual(nf);
      expect((await call('GET', `/v1/library/source?${q}&courseId=${courseId}`, t)).json).toEqual(
        nf,
      );
      expect((await call('GET', `/v1/library/files/${fileId}`, t)).status).toBe(404);
      expect((await call('GET', `/v1/library/files/${fileId}/raw`, t)).status).toBe(404);
      expect(
        (await call('PATCH', `/v1/library/courses/${courseId}`, t, { visibility: 'squad' })).status,
      ).toBe(404);
      expect(
        (await call('DELETE', `/v1/library/courses/${courseId}`, t, { confirm: true })).status,
      ).toBe(404);
      expect(
        (
          await call('POST', `/v1/library/courses/${courseId}/chapters/merge`, t, {
            from: 'a',
            into: 'b',
          })
        ).status,
      ).toBe(404);
      const up = await upload(t, courseId, 'x.txt', 'intruder text here');
      expect(up.status).toBe(404);
    }
    expect(gone.json).toEqual(nf);
    // nothing of A's text in B's or Z's streams, and not in the event log
    const log = JSON.stringify(hub.deps.events.since(0));
    expect(log).not.toContain('moonlit');
    for (const t of [ben, zed]) {
      const { body } = await post<{ st: string }>(url, '/v1/squad/stream-token', {}, t);
      const sse = await openSse(url, { st: body.st, lastEventId: 0 });
      await new Promise((r) => setTimeout(r, 150));
      expect(JSON.stringify(sse.frames)).not.toMatch(/moonlit|notes\.txt|ch6\.pdf/);
      sse.stop();
    }
  });

  it('squad opt-in is owner-only and limited to the same squad', async () => {
    expect(
      (await call('PATCH', `/v1/library/courses/${courseId}`, ana, { visibility: 'public' }))
        .status,
    ).toBe(400);
    const p = await call('PATCH', `/v1/library/courses/${courseId}`, ana, { visibility: 'squad' });
    expect(p.json.visibility).toBe('squad');
    const q = `file=notes.txt&page=1&quote=${encodeURIComponent(SECRET)}`;
    const b = await call('GET', `/v1/library/source?${q}`, ben);
    expect(b.json).toMatchObject({ ok: true, quoteVerified: true });
    expect((await call('GET', `/v1/library/courses/${courseId}`, ben)).json).toMatchObject({
      role: 'squad',
      canEdit: false,
    });
    expect((await fetch(`${url}/v1/library/files/${fileId}/raw`, { headers: H(ben) })).status).toBe(
      200,
    );
    // readable but not owner: mutations are forbidden, not hidden
    expect(
      (await call('PATCH', `/v1/library/courses/${courseId}`, ben, { title: 'mine now' })).status,
    ).toBe(403);
    expect((await call('DELETE', `/v1/library/files/${fileId}`, ben)).status).toBe(403);
    expect((await call('GET', `/v1/library/source?${q}`, zed)).status).toBe(404);
    await call('PATCH', `/v1/library/courses/${courseId}`, ana, { visibility: 'private' });
    expect((await call('GET', `/v1/library/source?${q}`, ben)).status).toBe(404);
  });

  it('chapter editor splits, renames and merges without losing pages', async () => {
    const lines = Array.from(
      { length: 90 },
      (_, i) => `Line ${i + 1} covers the idea number ${i + 1}.`,
    ).join('\n');
    const up = await upload(ana, courseId, 'book.md', lines);
    await ready(ana, up.json.fileId);
    const before = await call('GET', `/v1/library/courses/${courseId}`, ana);
    const book = before.json.chapters.find((c: any) => c.file === 'book.md');
    expect(book).toMatchObject({ pageStart: 1, pageEnd: 3 });
    const sp = await call('POST', `/v1/library/courses/${courseId}/chapters/split`, ana, {
      chapter: book.id,
      atPage: 2,
      title: 'Second half',
    });
    expect(sp.status).toBe(200);
    expect(sp.json.created).toBe('second-half');
    expect(
      sp.json.chapters
        .filter((c: any) => c.file === 'book.md')
        .map((c: any) => [c.pageStart, c.pageEnd]),
    ).toEqual([
      [1, 1],
      [2, 3],
    ]);
    expect(
      (
        await call('POST', `/v1/library/courses/${courseId}/chapters/split`, ana, {
          chapter: book.id,
          atPage: 1,
          title: 'x',
        })
      ).status,
    ).toBe(400);
    const rn = await call('PATCH', `/v1/library/courses/${courseId}/chapters/second-half`, ana, {
      title: 'Renamed',
    });
    expect(rn.json.chapters.find((c: any) => c.id === 'second-half').title).toBe('Renamed');
    const mg = await call('POST', `/v1/library/courses/${courseId}/chapters/merge`, ana, {
      from: 'second-half',
      into: book.id,
    });
    expect(mg.json.chapters.filter((c: any) => c.file === 'book.md')).toHaveLength(1);
    const d = await call('GET', `/v1/library/courses/${courseId}`, ana);
    expect(d.json.pageCount).toBe(1 + 2 + 3);
  });

  it('syllabus: policy lines are verbatim and courses.policy stays in sync', async () => {
    const syl = readFileSync(join(FIXTURE_DIR, 'syllabus.txt'), 'utf8');
    const put = await call('PUT', `/v1/library/courses/${courseId}/syllabus`, ana, { text: syl });
    expect(put.status).toBe(200);
    const src = new Set(syl.split(/\r?\n/).map((l) => l.trim()));
    const lines = put.json.policy.lines as {
      n: number;
      text: string;
      verbatim: boolean;
      topic: string;
    }[];
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) {
      expect(src.has(l.text)).toBe(true);
      expect(l.verbatim).toBe(true);
    }
    expect(lines.find((l) => l.text.startsWith('Using an AI assistant'))?.topic).toBe('ai');
    const policy = (
      hub.deps.db.prepare('SELECT policy FROM courses WHERE id=?').get(courseId) as {
        policy: string;
      }
    ).policy;
    expect(policy).toBe(lines.map((l) => l.text).join('\n'));
    // upload with kind=syllabus does the same
    const f = await upload(
      ana,
      courseId,
      'syllabus.txt',
      'Homework is graded.\nOffice hours Thursday.',
      'syllabus',
    );
    await ready(ana, f.json.fileId);
    const d = await call('GET', `/v1/library/courses/${courseId}`, ana);
    expect(d.json.policy).toMatchObject({
      sourceFile: 'syllabus.txt',
      lines: [{ n: 1, text: 'Homework is graded.' }],
    });
  });

  it('catalogue: sample until imported; CSV and JSON round trip; errors name rows', async () => {
    const s = await call('GET', '/v1/library/catalogue', ana);
    expect(s.json).toMatchObject({ sample: true, source: 'sample' });
    expect(s.json.catalogue.sample).toBe(true);
    expect(s.json.catalogue.name).toContain('SAMPLE DATA');
    const csv =
      'id,title,credits,prereqs,coreqs,workload,offered,area,days,start,end\nCSL 101,Intro,3,,,6,fall;spring,core,MW,09:00,10:15\nCSL 102,Next,3,CSL 101,,7,fall|spring,core,TR,09:00,10:15\n';
    const put = await fetch(`${url}/v1/library/catalogue`, {
      method: 'PUT',
      headers: H(ana, { 'content-type': 'text/csv' }),
      body: csv,
    });
    expect(put.status).toBe(200);
    const mine = await call('GET', '/v1/library/catalogue', ana);
    expect(mine.json).toMatchObject({ sample: false, source: 'student' });
    expect(mine.json.catalogue.courses.map((c: any) => c.id)).toEqual(['CSL 101', 'CSL 102']);
    expect((await call('GET', '/v1/library/catalogue', ben)).json.sample).toBe(true); // per student
    const bad = await fetch(`${url}/v1/library/catalogue`, {
      method: 'PUT',
      headers: H(ana, { 'content-type': 'text/csv' }),
      body: csv.replace(',3,CSL 101', ',x,CSL 101'),
    });
    expect(bad.status).toBe(422);
    const bj = (await bad.json()) as any;
    expect(bj.details).toEqual([{ row: 3, field: 'credits', code: 'invalid_number' }]);
    const json = await fetch(`${url}/v1/library/catalogue`, {
      method: 'PUT',
      headers: H(ana, { 'content-type': 'application/json' }),
      body: JSON.stringify(s.json.catalogue),
    });
    expect(json.status).toBe(200);
    expect((await call('GET', '/v1/library/catalogue', ana)).json.catalogue.courses.length).toBe(
      s.json.catalogue.courses.length,
    );
  });

  it('delete is two-step and cascades; later citations say removed or not_found', async () => {
    const stored = hub.deps.db
      .prepare('SELECT stored_path p FROM lib_files WHERE course_id=?')
      .all(courseId) as { p: string }[];
    expect(stored.length).toBeGreaterThan(0);
    const first = await call('DELETE', `/v1/library/courses/${courseId}`, ana, {});
    expect(first.status).toBe(409);
    expect(first.json.error.code).toBe('confirm_required');
    expect(first.json.counts).toMatchObject({ courses: 1, files: 4 });
    expect(first.json.counts.pages).toBeGreaterThan(5);
    expect((await call('GET', `/v1/library/courses/${courseId}`, ana)).status).toBe(200);
    const del = await call('DELETE', `/v1/library/courses/${courseId}`, ana, { confirm: true });
    expect(del.status).toBe(200);
    expect(del.json.deleted).toEqual(first.json.counts);
    expect((await call('GET', `/v1/library/courses/${courseId}`, ana)).status).toBe(404);
    expect((await call('GET', `/v1/library/files/${fileId}`, ana)).status).toBe(404);
    const db = hub.deps.db;
    for (const [t, c] of [
      ['pages', 'course_id'],
      ['chapters', 'course_id'],
      ['lib_files', 'course_id'],
      ['courses', 'id'],
    ])
      expect(
        (db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${c}=?`).get(courseId) as { n: number }).n,
      ).toBe(0);
    const { existsSync } = await import('node:fs');
    for (const s of stored) expect(existsSync(s.p)).toBe(false);
    expect(
      (await call('GET', '/v1/library/courses', ana)).json.courses.map((c: any) => c.id),
    ).toEqual(['demo']);
  });

  it('rejects malformed bodies and never echoes user content in errors', async () => {
    const r = await call('POST', '/v1/library/courses', ana, { title: '', evil: 'zzz-secret' });
    expect(r.status).toBe(400);
    expect(r.text).not.toContain('zzz-secret');
    const form = new FormData();
    form.set('nofile', 'x');
    const noFile = await fetch(`${url}/v1/library/courses/${courseId}/files`, {
      method: 'POST',
      headers: H(ana),
      body: form,
    });
    expect(noFile.status).toBe(404); // deleted course
  });
});
