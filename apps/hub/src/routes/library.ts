import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  COURSE_ID_RE,
  DEMO_COURSE_ID,
  LIBRARY_LIMITS,
  LibraryError,
  SourceQuery,
  createLibraryStore,
  createPipeline,
  deleteCourse,
  detail,
  ensureDemoCourse,
  extractPolicyLines,
  mergeChaptersIn,
  parseCatalogue,
  policyColumn,
  policyPanel,
  previewCascade,
  renameChapterIn,
  resolveSource,
  sampleCatalogue,
  splitChapterIn,
  summarizeCourse,
  toFileRow,
  createCourseStore,
  type LibraryStore,
  type Role,
} from '@squad/brain';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const Title = z.string().trim().min(1).max(LIBRARY_LIMITS.maxTitleChars);
const CreateBody = z.strictObject({ title: Title });
const PatchBody = z
  .strictObject({ title: Title.optional(), visibility: z.enum(['private', 'squad']).optional() })
  .refine((b) => b.title !== undefined || b.visibility !== undefined);
const DeleteBody = z.strictObject({ confirm: z.boolean().optional() });
const SplitBody = z.strictObject({
  chapter: z.string().min(1).max(64),
  atPage: z.number().int().min(1).max(100_000),
  title: z.string().min(1).max(400),
});
const MergeBody = z.strictObject({
  from: z.string().min(1).max(64),
  into: z.string().min(1).max(64),
});
const RenameBody = z.strictObject({ title: z.string().min(1).max(400) });
const SyllabusBody = z.strictObject({
  text: z.string().min(1).max(LIBRARY_LIMITS.maxSyllabusChars),
});
const Kind = z.enum(['material', 'syllabus']);

const STATUS: Record<string, 400 | 404 | 409 | 413 | 415 | 422> = {
  unsupported_type: 415,
  too_large: 413,
  duplicate: 409,
  chapter_not_found: 404,
  invalid_title: 400,
  invalid_split_point: 400,
  invalid_merge: 400,
  chapter_not_contiguous: 409,
  chapters_not_adjacent: 409,
  chapters_in_different_files: 409,
};

/** Reads the request body, aborting as soon as it exceeds `max` bytes (content-length is only a hint). */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export function libraryDataDir(deps: HubDeps): string {
  if (process.env.LIBRARY_DATA_DIR) return process.env.LIBRARY_DATA_DIR;
  const p = deps.config.dbPath;
  return p === ':memory:'
    ? mkdtempSync(join(tmpdir(), 'squad-library-'))
    : join(dirname(p), 'library');
}

export function createLibraryRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const lib: LibraryStore = createLibraryStore({
    db: deps.db,
    courses: createCourseStore(deps.db),
    dataDir: libraryDataDir(deps),
    now: deps.now,
    squadOf: (s) => deps.directory.squadOf(s),
  });
  const pipeline = createPipeline(lib, (e) => {
    const res = deps.ingest.x('x.ingest.progress', {
      student: e.owner,
      courseId: e.courseId,
      file: e.file,
      status: e.status,
      pct: e.pct,
    });
    if (!res.ok) deps.log.warn('library progress rejected', { status: e.status });
  });
  // The chat `semester plan` skill reads the asker's own catalogue through this (labelled sample fallback otherwise).
  (deps as unknown as { catalogueFor?: (s: string) => unknown }).catalogueFor = (s) =>
    lib.getCatalogue(s);
  const recovered = lib.recoverInterrupted();
  if (recovered > 0) deps.log.info('library: interrupted ingests marked failed', { recovered });
  // Exposed for tests: wait for queued ingests.
  (deps as HubDeps & { libraryIdle?: () => Promise<void> }).libraryIdle = () => pipeline.idle();

  const fail = (c: Context, status: number, code: string, extra: Record<string, unknown> = {}) =>
    c.json({ error: { code }, ...extra }, status as 400);
  const notFound = (c: Context) => fail(c, 404, 'not_found');
  const demo = () =>
    ensureDemoCourse(lib).catch(() => deps.log.warn('library: sample course unavailable'));
  const libError = (c: Context, e: unknown) => {
    if (e instanceof LibraryError) return fail(c, STATUS[e.code] ?? 422, e.code, e.data ?? {});
    deps.log.error('library error', { err: e instanceof Error ? e.name : 'unknown' });
    return fail(c, 500, 'internal');
  };

  /** Course the viewer may read, else null (callers answer 404, never 403). */
  const readable = (courseId: string, viewer: string) => {
    const row =
      COURSE_ID_RE.test(courseId) || courseId === DEMO_COURSE_ID ? lib.course(courseId) : undefined;
    const role = row ? lib.roleOf(courseId, viewer) : null;
    return row && role ? { row, role } : null;
  };
  const ownerOnly = (c: Context, courseId: string) => {
    const viewer = c.get('viewer').studentId;
    const got = readable(courseId, viewer);
    if (!got) return { res: notFound(c) };
    if (got.role !== 'owner') return { res: fail(c, 403, 'forbidden') };
    return { got };
  };
  const json = async (c: Context): Promise<unknown> => c.req.json().catch(() => null);
  const bad = (c: Context) => fail(c, 400, 'invalid_request');

  r.get('/v1/library/courses', need, async (c) => {
    await demo();
    const me = c.get('viewer').studentId;
    return c.json({
      courses: lib.readable(me).map(({ row, role }) => summarizeCourse(lib, row, role, me)),
      limits: LIBRARY_LIMITS,
    });
  });

  r.post('/v1/library/courses', need, async (c) => {
    const p = CreateBody.safeParse(await json(c));
    if (!p.success) return bad(c);
    const me = c.get('viewer').studentId;
    const row = lib.createCourse(me, p.data.title);
    return c.json(summarizeCourse(lib, row, 'owner', me), 201);
  });

  r.get('/v1/library/courses/:id', need, async (c) => {
    if (c.req.param('id') === DEMO_COURSE_ID) await demo();
    const me = c.get('viewer').studentId;
    const got = readable(c.req.param('id'), me);
    return got ? c.json(detail(lib, got.row, got.role, me)) : notFound(c);
  });

  r.patch('/v1/library/courses/:id', need, async (c) => {
    const o = ownerOnly(c, c.req.param('id'));
    if (o.res) return o.res;
    const p = PatchBody.safeParse(await json(c));
    if (!p.success) return bad(c);
    lib.patchCourse(c.req.param('id'), {
      ...(p.data.title !== undefined ? { title: p.data.title } : {}),
      ...(p.data.visibility !== undefined ? { visibility: p.data.visibility } : {}),
    });
    const me = c.get('viewer').studentId;
    return c.json(detail(lib, lib.course(c.req.param('id'))!, 'owner', me));
  });

  r.delete('/v1/library/courses/:id', need, async (c) => {
    const id = c.req.param('id');
    const o = ownerOnly(c, id);
    if (o.res) return o.res;
    const p = DeleteBody.safeParse((await json(c)) ?? {});
    if (!p.success) return bad(c);
    if (p.data.confirm !== true)
      return fail(c, 409, 'confirm_required', { counts: previewCascade(lib, id) });
    await pipeline.idle();
    const deleted = deleteCourse(lib, id);
    deps.log.info('library: course deleted', { files: deleted.files, pages: deleted.pages });
    return c.json({ deleted });
  });

  r.post('/v1/library/courses/:id/files', need, async (c) => {
    const id = c.req.param('id');
    const o = ownerOnly(c, id);
    if (o.res) return o.res;
    const ct = c.req.header('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('multipart/form-data')) return bad(c);
    // Hard guard before anything is buffered: file cap plus a small allowance for multipart framing.
    const body = await readLimited(c.req.raw, LIBRARY_LIMITS.maxFileBytes + 64 * 1024);
    if (!body) return fail(c, 413, 'too_large');
    let form: FormData;
    try {
      form = await new Response(body, { headers: { 'content-type': ct } }).formData();
    } catch {
      return bad(c);
    }
    const file = form.get('file');
    const kind = Kind.safeParse(form.get('kind') ?? 'material');
    if (!(file instanceof File) || !kind.success) return bad(c);
    try {
      const rec = await pipeline.submit({
        owner: c.get('viewer').studentId,
        courseId: id,
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: kind.data,
      });
      return c.json({ fileId: rec.fileId, status: 'queued' as const }, 202);
    } catch (e) {
      return libError(c, e);
    }
  });

  /** File + role, or null. The file id alone grants nothing. */
  const fileFor = (c: Context, fileId: string) => {
    const f = lib.file(fileId);
    const role: Role | null = f ? lib.roleOf(f.courseId, c.get('viewer').studentId) : null;
    return f && role ? { f, role } : null;
  };

  r.get('/v1/library/files/:fileId', need, (c) => {
    const got = fileFor(c, c.req.param('fileId'));
    return got ? c.json(toFileRow(got.f)) : notFound(c);
  });

  r.post('/v1/library/files/:fileId/reingest', need, (c) => {
    const got = fileFor(c, c.req.param('fileId'));
    if (!got) return notFound(c);
    if (got.role !== 'owner') return fail(c, 403, 'forbidden');
    const f = pipeline.reingest(got.f.fileId);
    return f ? c.json({ fileId: f.fileId, status: 'queued' as const }, 202) : fail(c, 409, 'busy');
  });

  r.delete('/v1/library/files/:fileId', need, async (c) => {
    const got = fileFor(c, c.req.param('fileId'));
    if (!got) return notFound(c);
    if (got.role !== 'owner') return fail(c, 403, 'forbidden');
    await pipeline.idle();
    lib.removeFile(got.f.fileId);
    return c.json({ removed: true });
  });

  r.get('/v1/library/files/:fileId/raw', need, async (c) => {
    const got = fileFor(c, c.req.param('fileId'));
    if (!got?.f.storedPath || got.f.status === 'failed') return notFound(c);
    const bytes = await readFile(got.f.storedPath).catch(() => null);
    if (!bytes) return notFound(c);
    const type = got.f.mime === 'application/pdf' ? 'application/pdf' : 'text/plain; charset=utf-8';
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': type,
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'private, no-store',
      },
    });
  });

  const chapterOp = (fn: (id: string, body: unknown) => unknown) => async (c: Context) => {
    const id = c.req.param('id') ?? '';
    const o = ownerOnly(c, id);
    if (o.res) return o.res;
    try {
      return c.json(fn(id, await json(c)));
    } catch (e) {
      if (e instanceof z.ZodError) return bad(c);
      return libError(c, e);
    }
  };
  const chaptersOf = (id: string, me: string) =>
    summarizeCourse(lib, lib.course(id)!, 'owner', me).chapters;

  r.post('/v1/library/courses/:id/chapters/split', need, (c) =>
    chapterOp((id, raw) => {
      const b = SplitBody.parse(raw);
      const created = splitChapterIn(lib, id, b.chapter, b.atPage, b.title);
      return { created, chapters: chaptersOf(id, c.get('viewer').studentId) };
    })(c),
  );
  r.post('/v1/library/courses/:id/chapters/merge', need, (c) =>
    chapterOp((id, raw) => {
      const b = MergeBody.parse(raw);
      mergeChaptersIn(lib, id, b.from, b.into);
      return { chapters: chaptersOf(id, c.get('viewer').studentId) };
    })(c),
  );
  r.patch('/v1/library/courses/:id/chapters/:chId', need, (c) =>
    chapterOp((id, raw) => {
      const b = RenameBody.parse(raw);
      renameChapterIn(lib, id, c.req.param('chId'), b.title);
      return { chapters: chaptersOf(id, c.get('viewer').studentId) };
    })(c),
  );

  r.put('/v1/library/courses/:id/syllabus', need, async (c) => {
    const id = c.req.param('id');
    const o = ownerOnly(c, id);
    if (o.res) return o.res;
    const p = SyllabusBody.safeParse(await json(c));
    if (!p.success || p.data.text.trim() === '') return bad(c);
    const lines = extractPolicyLines(p.data.text);
    lib.setSyllabus(id, null, p.data.text, lines, policyColumn(p.data.text, lines));
    return c.json({ policy: policyPanel(lib, id) });
  });

  const catalogueBody = (student: string) => {
    const mine = lib.getCatalogue(student);
    return mine
      ? { catalogue: mine, sample: false, source: 'student' as const }
      : { catalogue: sampleCatalogue(), sample: true, source: 'sample' as const };
  };
  r.get('/v1/library/catalogue', need, (c) => c.json(catalogueBody(c.get('viewer').studentId)));
  r.put('/v1/library/catalogue', need, async (c) => {
    const body = await readLimited(c.req.raw, LIBRARY_LIMITS.maxCatalogueBytes);
    if (!body) return fail(c, 413, 'too_large');
    const name = c.req.query('name')?.slice(0, 80);
    const res = parseCatalogue(
      new TextDecoder().decode(body),
      c.req.header('content-type') ?? '',
      name,
    );
    if (!res.ok) return fail(c, 422, 'invalid_catalogue', { details: res.errors });
    const me = c.get('viewer').studentId;
    lib.setCatalogue(me, res.catalogue);
    return c.json(catalogueBody(me));
  });

  r.get('/v1/library/source', need, async (c) => {
    const p = SourceQuery.safeParse(c.req.query());
    if (!p.success) return bad(c);
    if (!p.data.courseId || p.data.courseId === DEMO_COURSE_ID) await demo();
    const out = resolveSource(lib, c.get('viewer').studentId, p.data);
    return c.json(out, !out.ok && out.reason === 'not_found' ? 404 : 200);
  });

  return r;
}
