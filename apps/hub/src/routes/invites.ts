import { InviteCreateBodySchema, InviteJoinBodySchema, parseInviteInput } from '@squad/core';
import { Hono } from 'hono';
import { requireUser } from '../auth';
import { clientIp, createLimiter, fail, rateLimited, readBody } from '../http';
import { webBaseFor } from '../web-origin';
import type { HubApp, HubDeps, HubEnv } from '../types';
import { activateSquad, announceMember } from './squads';

export function createInviteRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const user = requireUser(deps);
  const limit = createLimiter(deps.now);

  /** Links point at the web origin that asked, when it is a listed origin; else HUB_WEB_URL. */
  const webBase = (origin: string | undefined) => webBaseFor(deps.config, origin);

  r.post('/v1/squads/:id/invites', user, async (c) => {
    const b = await readBody(c, InviteCreateBodySchema);
    if (!b.ok) return b.res;
    const res = deps.squads.createInvite(
      c.req.param('id'),
      c.get('user').id,
      b.data,
      webBase(c.req.header('origin')),
    );
    return res.ok ? c.json({ invite: res.invite }, 201) : fail(c, res);
  });

  r.get('/v1/squads/:id/invites', user, (c) => {
    const list = deps.squads.listInvites(
      c.req.param('id'),
      c.get('user').id,
      webBase(c.req.header('origin')),
    );
    return list ? c.json({ invites: list }) : c.json({ error: { code: 'not_found' } }, 404);
  });

  r.delete('/v1/squads/:id/invites/:inviteId', user, (c) => {
    const res = deps.squads.revokeInvite(
      c.req.param('id'),
      c.get('user').id,
      c.req.param('inviteId'),
    );
    return res.ok ? c.json({ ok: true }) : fail(c, res);
  });

  // Public preview. Rate limited per address so codes cannot be walked.
  r.get('/v1/invites/:code', (c) => {
    const rl = limit(`preview:${clientIp(c)}`, 120, 600_000);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS ?? 1);
    const res = deps.squads.preview(c.req.param('code'));
    return res.ok ? c.json(res.preview) : fail(c, res);
  });

  r.post('/v1/invites/join', user, async (c) => {
    const b = await readBody(c, InviteJoinBodySchema);
    if (!b.ok) return b.res;
    const uid = c.get('user').id;
    const rl = limit(`join:${uid}`, 10, 3_600_000);
    if (!rl.ok) return rateLimited(c, rl.retryAfterS ?? 1);
    const code = parseInviteInput(b.data.code);
    if (!code)
      return c.json(
        { error: { code: 'invite_invalid', message: 'That code does not look right.' } },
        404,
      );
    const res = deps.squads.join(uid, code);
    if (!res.ok) return fail(c, res);
    activateSquad(deps, uid, res.squadId);
    announceMember(deps, uid);
    return c.json({ squad: deps.squads.detail(res.squadId, uid), activeSquadId: res.squadId });
  });

  return r;
}
