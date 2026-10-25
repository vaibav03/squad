import { Hono, type Context } from 'hono';
import {
  PlanDoneBodySchema,
  PlanEditBodySchema,
  PlanProposeBodySchema,
  PlanRespondBodySchema,
  PlanResolveBodySchema,
} from '@squad/core';
import { requireViewer } from '../auth';
import type { HubApp, HubDeps, HubEnv } from '../types';
import type { PlanFail, PlanResult } from './service';

const err = (code: string, message?: string) => ({
  error: { code, ...(message ? { message } : {}) },
});

export function createPlanRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();
  const need = requireViewer(deps);
  const plans = () => deps.plans;

  /** Reply for a service result. A decision or failure with something to say is mirrored into the group chat. */
  const reply = (c: Context<HubEnv>, res: PlanResult, squadId: string) => {
    if (res.say?.text) plans().post(squadId, res.say);
    const v = c.get('viewer');
    if (res.ok) return c.json({ plan: plans().view(v, res.plan) });
    const f: PlanFail = res;
    return c.json(
      {
        error: { code: f.code, message: f.message },
        ...(f.conflictId ? { conflict: f.plan?.conflicts.find((x) => x.id === f.conflictId) } : {}),
        ...(f.plan ? { plan: plans().view(v, f.plan) } : {}),
      },
      f.status,
    );
  };
  const json = async (c: { req: { json(): Promise<unknown> } }) => c.req.json().catch(() => null);

  r.get('/v1/plans/current', need, (c) => {
    const v = c.get('viewer');
    const p = plans().current(v);
    return c.json({ plan: p ? plans().view(v, p) : null });
  });

  r.get('/v1/plans/:id', need, (c) => {
    const v = c.get('viewer');
    const p = plans().get(v, c.req.param('id'));
    return p ? c.json(plans().view(v, p)) : c.json(err('not_found'), 404);
  });

  r.post('/v1/plans', need, async (c) => {
    const v = c.get('viewer');
    const body = PlanProposeBodySchema.safeParse((await json(c)) ?? {});
    if (!body.success) return c.json(err('invalid_request'), 400);
    const res = await plans().propose(v, body.data);
    // a failed proposal is also said in the group, so nobody waits for a plan that is not coming
    if (!res.ok && !res.say)
      plans().post(v.squadId, { text: `The study plan could not be made: ${res.message}` });
    return reply(c, res, v.squadId);
  });

  r.post('/v1/plans/:id/respond', need, async (c) => {
    const v = c.get('viewer');
    const body = PlanRespondBodySchema.safeParse(await json(c));
    if (!body.success) return c.json(err('invalid_request'), 400);
    return reply(c, plans().respond(v, c.req.param('id'), body.data.response), v.squadId);
  });

  r.patch('/v1/plans/:id/items/:itemId', need, async (c) => {
    const v = c.get('viewer');
    const body = PlanEditBodySchema.safeParse(await json(c));
    if (!body.success) return c.json(err('invalid_request'), 400);
    return reply(
      c,
      plans().edit(v, c.req.param('id'), c.req.param('itemId'), body.data.baseRev, body.data.patch),
      v.squadId,
    );
  });

  r.post('/v1/plans/:id/conflicts/:cid/resolve', need, async (c) => {
    const v = c.get('viewer');
    const body = PlanResolveBodySchema.safeParse(await json(c));
    if (!body.success) return c.json(err('invalid_request'), 400);
    return reply(
      c,
      plans().resolve(v, c.req.param('id'), c.req.param('cid'), body.data.pick),
      v.squadId,
    );
  });

  r.post('/v1/plans/:id/confirm', need, (c) => {
    const v = c.get('viewer');
    return reply(c, plans().confirm(v, c.req.param('id')), v.squadId);
  });

  r.post('/v1/plans/:id/cancel', need, (c) => {
    const v = c.get('viewer');
    return reply(c, plans().cancel(v, c.req.param('id')), v.squadId);
  });

  r.post('/v1/plans/:id/items/:itemId/done', need, async (c) => {
    const v = c.get('viewer');
    const body = PlanDoneBodySchema.safeParse((await json(c)) ?? {});
    if (!body.success) return c.json(err('invalid_request'), 400);
    return reply(
      c,
      plans().done(v, c.req.param('id'), c.req.param('itemId'), body.data.done ?? true),
      v.squadId,
    );
  });

  return r;
}
