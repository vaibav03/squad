// Collaborative trip routes. The service owns every rule (docs/trip-planning.md); this file only parses, resolves the
// trip id (trip id or task id, seeded or created) and maps results to HTTP.
import { Hono } from 'hono';
import {
  TripConfirmBodySchema,
  TripCreateBodySchema,
  TripOptionBodySchema,
  TripOptionEditBodySchema,
  TripVoteBodySchema,
} from '@squad/core';
import { requireViewer } from '../auth';
import type { Fail, Res } from '../trips/service';
import type { HubApp, HubDeps, HubEnv } from '../types';

const err = (code: string, message?: string) => ({
  error: { code, ...(message ? { message } : {}) },
});
const body = (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null);
type J = { json(b: unknown, s?: 400 | 403 | 404 | 409 | 422): Response };

export function createTripRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const svc = () => deps.tripSvc;
  const resolve = (id: string) => (deps.trips.get(id) ? id : (deps.trips.byTask(id)?.tripId ?? id));
  const failure = (c: J, f: Fail) =>
    c.json({ ...err(f.code, f.message), ...(f.extra ?? {}) }, f.status);
  const out = (c: J, res: Res) => (res.ok ? c.json({ trip: res.trip }) : failure(c, res));
  const bad = (c: J) => c.json(err('invalid_request'), 400);

  r.get('/v1/trips', need, (c) => c.json({ trips: svc().list(c.get('viewer')) }));
  // The squad's current trip; `null` is a normal answer (nothing planned yet), never an error.
  r.get('/v1/trips/current', need, (c) => c.json({ trip: svc().current(c.get('viewer')) }));

  r.post('/v1/trips', need, async (c) => {
    const p = TripCreateBodySchema.safeParse(await body(c));
    if (!p.success) return bad(c);
    return out(c, await svc().create(c.get('viewer'), p.data, 'page'));
  });

  r.get('/v1/trips/:tripId', need, (c) => {
    const v = svc().get(c.get('viewer'), resolve(c.req.param('tripId')));
    return v ? c.json(v) : c.json(err('not_found'), 404);
  });

  r.post('/v1/trips/:tripId/options', need, async (c) => {
    const p = TripOptionBodySchema.safeParse(await body(c));
    if (!p.success) return bad(c);
    return out(c, svc().addOption(c.get('viewer'), resolve(c.req.param('tripId')), p.data));
  });
  r.patch('/v1/trips/:tripId/options/:optionId', need, async (c) => {
    const p = TripOptionEditBodySchema.safeParse(await body(c));
    if (!p.success) return bad(c);
    return out(
      c,
      svc().editOption(
        c.get('viewer'),
        resolve(c.req.param('tripId')),
        c.req.param('optionId'),
        p.data,
      ),
    );
  });
  r.delete('/v1/trips/:tripId/options/:optionId', need, (c) => {
    const q = c.req.query('baseRev');
    const baseRev = q === undefined ? undefined : Number(q);
    if (baseRev !== undefined && !Number.isInteger(baseRev)) return bad(c);
    return out(
      c,
      svc().removeOption(
        c.get('viewer'),
        resolve(c.req.param('tripId')),
        c.req.param('optionId'),
        baseRev,
        c.req.query('replace') === '1',
      ),
    );
  });

  r.post('/v1/trips/:tripId/vote', need, async (c) => {
    const p = TripVoteBodySchema.safeParse(await body(c));
    if (!p.success) return bad(c);
    const v = c.get('viewer');
    const id = resolve(c.req.param('tripId'));
    const t = deps.trips.get(id);
    if (t && !t.collab) {
      // Seeded mesh-driven trip: the mesh tallies, the hub only stores the ranking.
      if (t.squadId !== v.squadId) return c.json(err('not_found'), 404);
      if (!deps.trips.vote(id, v.studentId, p.data.ranking))
        return c.json(err('invalid_request', 'unknown option'), 400);
      deps.ingest.x('x.trip.touch', { tripId: id });
      return c.json({ ok: true });
    }
    return out(c, svc().vote(v, id, p.data));
  });

  r.post('/v1/trips/:tripId/confirm', need, async (c) => {
    const p = TripConfirmBodySchema.safeParse(await body(c));
    if (!p.success) return bad(c);
    const v = c.get('viewer');
    const id = resolve(c.req.param('tripId'));
    const t = deps.trips.get(id);
    if (t && !t.collab) {
      if (t.squadId !== v.squadId || !p.data.optionId) return c.json(err('not_found'), 404);
      const rec = deps.trips.confirm(id, v.studentId, p.data.optionId, p.data.yes);
      if (!rec) return c.json(err('not_found'), 404);
      deps.ingest.village({
        t: 'confirm.done',
        student: v.studentId,
        taskId: rec.taskId,
        question: 'Confirm trip',
      });
      deps.ingest.x('x.trip.touch', { tripId: id });
      if (deps.trips.allConfirmed(id))
        deps.ingest.village({ t: 'trip.confirmed', taskId: rec.taskId, squadId: rec.squadId });
      return c.json({ ok: true, status: rec.status });
    }
    return out(c, svc().confirm(v, id, p.data));
  });

  r.post('/v1/trips/:tripId/demo-go', need, (c) =>
    out(c, svc().demoGo(c.get('viewer'), resolve(c.req.param('tripId')))),
  );
  r.post('/v1/trips/:tripId/close-voting', need, (c) =>
    out(c, svc().closeVoting(c.get('viewer'), resolve(c.req.param('tripId')))),
  );
  r.post('/v1/trips/:tripId/retry', need, async (c) =>
    out(c, await svc().retry(c.get('viewer'), resolve(c.req.param('tripId')))),
  );
  r.post('/v1/trips/:tripId/continue', need, (c) =>
    out(c, svc().continueWithout(c.get('viewer'), resolve(c.req.param('tripId')))),
  );
  r.post('/v1/trips/:tripId/reopen', need, (c) =>
    out(c, svc().reopen(c.get('viewer'), resolve(c.req.param('tripId')))),
  );
  r.post('/v1/trips/:tripId/cancel', need, (c) =>
    out(c, svc().cancel(c.get('viewer'), resolve(c.req.param('tripId')))),
  );
  return r;
}
