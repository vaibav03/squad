import { Hono } from 'hono';
import { z } from 'zod';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const MAX_PDF = 50 * 1024 * 1024;
const Vote = z.strictObject({ ranking: z.array(z.string().min(1)).min(1).max(20) });
const Confirm = z.strictObject({ optionId: z.string().min(1), yes: z.boolean() });
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
          title: taskId === 'task_study_ch5' ? 'Chapter 5 study plan' : taskId,
          status: 'active',
          updatedAt: deps.now(),
        })),
      ...trips.map((t) => ({
        taskId: t.taskId,
        kind: 'trip' as const,
        title: 'Group trip',
        status: t.status,
        updatedAt: deps.now(),
      })),
    ];
    return c.json({ tasks });
  });

  r.get('/v1/ledger/:taskId', need, (c) =>
    c.json({
      taskId: c.req.param('taskId'),
      entries: deps.ledger.entries(c.req.param('taskId'), c.get('viewer')),
    }),
  );

  r.get('/v1/trips/:tripId', need, (c) => {
    const view = deps.trips.view(c.req.param('tripId'), c.get('viewer'), {
      directory: deps.directory,
    });
    return view ? c.json(view) : c.json(err('not_found'), 404);
  });

  r.post('/v1/trips/:tripId/vote', need, async (c) => {
    const v = c.get('viewer');
    const tripId = c.req.param('tripId');
    if (!deps.trips.view(tripId, v, { directory: deps.directory }))
      return c.json(err('not_found'), 404);
    const body = Vote.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err('invalid_request'), 400);
    if (!deps.trips.vote(tripId, v.studentId, body.data.ranking))
      return c.json(err('invalid_request', 'unknown option'), 400);
    deps.ingest.x('x.trip.touch', { tripId });
    return c.json({ ok: true });
  });

  r.post('/v1/trips/:tripId/confirm', need, async (c) => {
    const v = c.get('viewer');
    const tripId = c.req.param('tripId');
    const before = deps.trips.view(tripId, v, { directory: deps.directory });
    if (!before) return c.json(err('not_found'), 404);
    const body = Confirm.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err('invalid_request'), 400);
    const rec = deps.trips.confirm(tripId, v.studentId, body.data.optionId, body.data.yes);
    if (!rec) return c.json(err('not_found'), 404);
    deps.ingest.village({
      t: 'confirm.done',
      student: v.studentId,
      taskId: rec.taskId,
      question: 'Confirm trip',
    });
    deps.ingest.x('x.trip.touch', { tripId });
    if (deps.trips.allConfirmed(tripId))
      deps.ingest.village({ t: 'trip.confirmed', taskId: rec.taskId, squadId: rec.squadId });
    return c.json({ ok: true, status: rec.status });
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

  r.post('/v1/squad/calendar', need, async (c) => {
    const v = c.get('viewer');
    const ct = c.req.header('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const form = await c.req.parseBody().catch(() => null);
      const file = form?.file;
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.ics'))
        return c.json(err('invalid_request', '.ics file required'), 400);
      if (file.size > 5 * 1024 * 1024) return c.json(err('invalid_request', 'file too large'), 413);
      return c.json(await deps.ports.brain.loadCalendar(v.studentId, { ics: await file.text() }));
    }
    const body = Calendar.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(err('invalid_request'), 400);
    return c.json(await deps.ports.brain.loadCalendar(v.studentId, { demo: true }));
  });

  return r;
}
