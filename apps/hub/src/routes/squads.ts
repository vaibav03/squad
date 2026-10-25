import { SquadCreateBodySchema, SquadPatchBodySchema, agentId } from '@squad/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth';
import { fail, readBody } from '../http';
import type { HubApp, HubDeps, HubEnv } from '../types';

/** Makes `squadId` the user's active squad (server side, persisted for accounts). */
export function activateSquad(deps: HubDeps, userId: string, squadId: string): void {
  deps.directory.setActiveSquad(userId, squadId);
  deps.accounts.setActiveSquad(userId, squadId);
}

/** Puts the new member's agent on the village stream (idle) so the squad sees them. */
export function announceMember(deps: HubDeps, userId: string): void {
  void deps.ingest.village({ t: 'agent.state', agent: agentId.student(userId), state: 'idle' });
}

export function createSquadRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const user = requireUser(deps);
  const active = (id: string) => deps.directory.squadOf(id) ?? null;

  r.get('/v1/squads', user, (c) => {
    const id = c.get('user').id;
    return c.json({ squads: deps.squads.list(id, active(id)), activeSquadId: active(id) });
  });

  r.post('/v1/squads', user, async (c) => {
    const b = await readBody(c, SquadCreateBodySchema);
    if (!b.ok) return b.res;
    const id = c.get('user').id;
    const { squadId } = deps.squads.create(id, b.data);
    activateSquad(deps, id, squadId);
    announceMember(deps, id);
    return c.json({ squad: deps.squads.detail(squadId, id) }, 201);
  });

  r.get('/v1/squads/:id', user, (c) => {
    const d = deps.squads.detail(c.req.param('id'), c.get('user').id);
    return d ? c.json({ squad: d }) : c.json({ error: { code: 'not_found' } }, 404);
  });

  r.patch('/v1/squads/:id', user, async (c) => {
    const b = await readBody(c, SquadPatchBodySchema);
    if (!b.ok) return b.res;
    const id = c.req.param('id');
    const uid = c.get('user').id;
    if (!deps.squads.isMember(id, uid)) return c.json({ error: { code: 'not_found' } }, 404);
    const res = deps.squads.patch(id, uid, b.data);
    return res.ok ? c.json({ squad: deps.squads.detail(id, uid) }) : fail(c, res);
  });

  r.post('/v1/squads/:id/activate', user, (c) => {
    const id = c.req.param('id');
    const uid = c.get('user').id;
    if (!deps.squads.isMember(id, uid)) return c.json({ error: { code: 'not_found' } }, 404);
    activateSquad(deps, uid, id);
    return c.json({ activeSquadId: id });
  });

  r.delete('/v1/squads/:id', user, async (c) => {
    const b = await readBody(c, z.object({ confirm: z.string().min(1).max(80) }).strict());
    if (!b.ok) return b.res;
    const res = deps.squads.disband(c.req.param('id'), c.get('user').id, b.data.confirm);
    return res.ok ? c.json({ ok: true }) : fail(c, res);
  });

  return r;
}
