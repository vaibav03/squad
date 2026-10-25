import { Hono } from 'hono';
import { requireViewer, signToken, viewerFor } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';

const BEARER_TTL = 12 * 60 * 60 * 1000;
const STREAM_TTL = 5 * 60 * 1000;

export function createAuthRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);

  r.get('/v1/auth/students', (c) =>
    c.json({
      students: deps.directory.students().map((s) => ({
        id: s.id,
        name: s.name,
        ...(s.avatarUrl ? { avatarUrl: s.avatarUrl } : {}),
        ...(s.personaId ? { personaId: s.personaId } : {}),
      })),
    }),
  );

  r.post('/v1/auth/dev-login', async (c) => {
    if (deps.config.production && !deps.config.seed)
      return c.json({ error: { code: 'forbidden' } }, 403);
    const body = (await c.req.json().catch(() => null)) as { studentId?: unknown } | null;
    const id = typeof body?.studentId === 'string' ? body.studentId : '';
    const student = deps.directory.student(id);
    const viewer = student ? viewerFor(deps, id) : null;
    if (!student || !viewer)
      return c.json({ error: { code: 'not_found', message: 'unknown student' } }, 404);
    const { token } = signToken(
      deps.config.authSecret,
      { kind: 'bearer', sub: id, ttlMs: BEARER_TTL },
      deps.now(),
    );
    return c.json({ token, student, squadId: viewer.squadId });
  });

  r.get('/v1/me', need, (c) => {
    const v = c.get('viewer');
    return c.json({
      student: deps.directory.student(v.studentId),
      squadId: v.squadId,
      projector: v.projector,
    });
  });

  r.post('/v1/squad/stream-token', need, (c) => {
    const v = c.get('viewer');
    const { token, expiresAt } = signToken(
      deps.config.authSecret,
      { kind: 'stream', sub: v.studentId, ttlMs: STREAM_TTL },
      deps.now(),
    );
    return c.json({ st: token, expiresAt });
  });

  r.post('/v1/session/projector', need, async (c) => {
    const v = c.get('viewer');
    const body = (await c.req.json().catch(() => null)) as { on?: unknown } | null;
    if (typeof body?.on !== 'boolean') return c.json({ error: { code: 'invalid_request' } }, 400);
    if (body.on) deps.projector.add(v.studentId);
    else deps.projector.delete(v.studentId);
    return c.json({ projector: body.on });
  });

  return r;
}
