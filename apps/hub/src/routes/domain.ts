import { Hono } from 'hono';
import { z } from 'zod';
import { requireViewer } from '../auth';
import { groupLedger } from './group-ledger';
import type { HubApp, HubDeps, HubEnv } from '../types';

const MAX_PDF = 50 * 1024 * 1024;
const ConfirmGeneric = z.strictObject({ yes: z.boolean(), optionId: z.string().min(1).optional() });
const Calendar = z.strictObject({ demo: z.literal(true) });

const err = (code: string, message?: string) => ({
  error: { code, ...(message ? { message } : {}) },
});

export function createDomainRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);

  r.get('/v1/tasks', need, (c) => {
    const v = c.get('viewer');
    const trips = deps.trips.list(v.squadId);
    const tripTasks = new Set(trips.map((t) => t.taskId));
    const tasks = [
      ...deps.ledger
        .taskIds(v.squadId, deps.directory)
        .filter((id) => !tripTasks.has(id))
        .map((taskId) => ({
          taskId,
          kind: 'study' as const,
          title: taskId === 'task_study_ch6' ? 'Chapter 6 study plan' : taskId,
          status: 'active',
          updatedAt: deps.now(),
        })),
      ...trips.map((t) => ({
        taskId: t.taskId,
        kind: 'trip' as const,
        title: t.collab?.title ?? 'Group trip',
        status: t.status,
        updatedAt: deps.now(),
      })),
    ];
    return c.json({ tasks });
  });

  r.get('/v1/ledger/:taskId', need, (c) => {
    // Squad isolation: only rows owned by members of the viewer's squad, whatever the task id.
    const v = c.get('viewer');
    const members = new Set(deps.directory.squad(v.squadId)?.members ?? []);
    return c.json({
      taskId: c.req.param('taskId'),
      entries: deps.ledger.entries(c.req.param('taskId'), v).filter((e) => members.has(e.student)),
    });
  });

  // Group ledger: decisions, votes, edits and provenance for ONE group chat. `groupId` is `group:<squadId>`;
  // a viewer sees only their own squad's ledger, anything else is 404 (no existence leak).
  r.get('/v1/groups/:groupId/ledger', need, (c) => {
    const v = c.get('viewer');
    const groupId = c.req.param('groupId');
    if (groupId !== `group:${v.squadId}`) return c.json(err('not_found'), 404);
    return c.json({ groupId, entries: groupLedger(deps, v.squadId) });
  });

  // Generic confirm: any task with an owning handler (trip store, an agent's open confirm card, or a
  // registered kind). Unknown tasks fail closed with 404; handlers without wiring answer 422.
  r.get('/v1/confirms/:taskId', need, (c) => {
    const p = deps.confirms.preview(c.get('viewer'), c.req.param('taskId'));
    return p ? c.json(p) : c.json(err('unknown_task'), 404);
  });
  r.post('/v1/confirms/:taskId', need, async (c) => {
    const body = ConfirmGeneric.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err('invalid_request'), 400);
    const out = await deps.confirms.answer(c.get('viewer'), c.req.param('taskId'), {
      yes: body.data.yes,
      ...(body.data.optionId ? { optionId: body.data.optionId } : {}),
    });
    if (out.ok) return c.json({ ok: true, ...(out.status ? { status: out.status } : {}) });
    const status = {
      unknown_task: 404,
      unsupported_kind: 422,
      invalid_request: 400,
      upstream_failed: 502,
      already_answered: 409,
    }[out.code];
    return c.json(err(out.code, out.message), status as 404 | 422 | 400 | 502 | 409);
  });

  r.get('/v1/mastery/:courseId', need, async (c) => {
    const v = c.get('viewer');
    const courseId = c.req.param('courseId');
    const m = await deps.ports.brain.mastery(v.studentId, courseId);
    // Squad rows are never returned; the average only exists for squads of 3 or more.
    const squadAvg =
      deps.directory.isSmall(v.squadId) || m.squad.length === 0
        ? null
        : m.concepts.map((_, i) => {
            const col = m.squad.map((row) => row[i] ?? 0);
            return Math.round((col.reduce((a, b) => a + b, 0) / col.length) * 1000) / 1000;
          });
    return c.json({ courseId, concepts: m.concepts, mine: m.mine, squadAvg });
  });

  r.get('/v1/squad/courses', need, async (c) =>
    c.json({ courses: await deps.ports.brain.listCourses(c.get('viewer').studentId) }),
  );

  r.post('/v1/squad/courses', need, async (c) => {
    const v = c.get('viewer');
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > MAX_PDF + 1024 * 1024) return c.json(err('invalid_request', 'file too large'), 413);
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!(file instanceof File))
      return c.json(err('invalid_request', 'multipart field "file" required'), 400);
    if (file.size > MAX_PDF) return c.json(err('invalid_request', 'file too large'), 413);
    if (!(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')))
      return c.json(err('invalid_request', 'PDF only'), 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { courseId } = await deps.ports.brain.ingestCourse(v.studentId, {
      name: file.name,
      bytes,
    });
    deps.ingest.x('x.ingest.progress', {
      student: v.studentId,
      courseId,
      file: file.name,
      status: 'queued',
    });
    return c.json({ courseId, file: file.name, status: 'queued' as const }, 202);
  });

  /** Booleans only: whether this viewer has ingested a real .ics file (never the events themselves). */
  r.get('/v1/squad/calendar', need, (c) => {
    const row = deps.db
      .prepare('SELECT 1 AS x FROM hub_calendar_ics WHERE student=?')
      .get(c.get('viewer').studentId);
    return c.json({ ics: row !== undefined });
  });

  r.post('/v1/squad/calendar', need, async (c) => {
    const v = c.get('viewer');
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const form = await c.req.parseBody().catch(() => null);
      const file = form?.file;
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.ics'))
        return c.json(err('invalid_request', '.ics file required'), 400);
      if (file.size > 5 * 1024 * 1024) return c.json(err('invalid_request', 'file too large'), 413);
      const out = await deps.ports.brain.loadCalendar(v.studentId, { ics: await file.text() });
      // remember that a real .ics (not the demo calendar) was ingested, so setup can show it as done
      if (out.busyBlocks > 0)
        deps.db
          .prepare('INSERT OR REPLACE INTO hub_calendar_ics(student, at) VALUES(?,?)')
          .run(v.studentId, deps.now());
      return c.json(out);
    }
    const body = Calendar.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err('invalid_request'), 400);
    return c.json(await deps.ports.brain.loadCalendar(v.studentId, { demo: true }));
  });

  return r;
}
