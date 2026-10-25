import { SQUAD_ROLES } from '@squad/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth';
import { fail, readBody } from '../http';
import type { HubApp, HubDeps, HubEnv } from '../types';

export function createMemberRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const user = requireUser(deps);

  r.post('/v1/squads/:id/leave', user, (c) => {
    const res = deps.squads.leave(c.req.param('id'), c.get('user').id);
    return res.ok ? c.json({ ok: true, disbanded: res.disbanded }) : fail(c, res);
  });

  r.delete('/v1/squads/:id/members/:userId', user, (c) => {
    const res = deps.squads.remove(c.req.param('id'), c.get('user').id, c.req.param('userId'));
    return res.ok ? c.json({ ok: true }) : fail(c, res);
  });

  r.post('/v1/squads/:id/members/:userId/role', user, async (c) => {
    const b = await readBody(c, z.object({ role: z.enum(SQUAD_ROLES) }).strict());
    if (!b.ok) return b.res;
    const res = deps.squads.setRole(
      c.req.param('id'),
      c.get('user').id,
      c.req.param('userId'),
      b.data.role,
    );
    return res.ok ? c.json({ ok: true }) : fail(c, res);
  });

  return r;
}
