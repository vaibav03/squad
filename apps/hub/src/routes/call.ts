import { randomBytes } from 'node:crypto';
import { AgentIdSchema } from '@squad/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireViewer, signToken } from '../auth';
import { callSessions, connectedCalls, hangUp } from '../call-sessions';
import type { HubApp, HubDeps, HubEnv } from '../types';

export const MAX_CONCURRENT_CALLS = 8;
export const UNCONNECTED_MS = 60_000;
const TICKET_TTL = 5 * 60 * 1000;
const Start = z.strictObject({ agentId: AgentIdSchema });

export function createCallRoutes(deps: HubDeps): HubApp {
  const r = new Hono<HubEnv>();

  r.post('/v1/call/start', requireViewer(deps), async (c) => {
    const viewer = c.get('viewer');
    const body = Start.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'invalid_request' } }, 400);
    if (deps.calls.byStudent(viewer.studentId))
      return c.json({ error: { code: 'call_in_progress' } }, 409);
    if (deps.calls.active().length >= MAX_CONCURRENT_CALLS)
      return c.json({ error: { code: 'rate_limited' } }, 429);

    const agent = body.data.agentId;
    const callId = `call_${randomBytes(6).toString('hex')}`;
    const session = await deps.ports.call.open({ callId, agent, student: viewer.studentId });
    if (!session) return c.json({ error: { code: 'not_found', message: 'unknown agent' } }, 404);
    // another request may have won while we awaited the port
    if (deps.calls.byStudent(viewer.studentId)) {
      await session.close();
      return c.json({ error: { code: 'call_in_progress' } }, 409);
    }
    deps.calls.open({ callId, agent, student: viewer.studentId, squadId: viewer.squadId });
    callSessions.set(callId, session);
    deps.ingest.village({ t: 'agent.state', agent, state: 'in_call' });
    deps.ingest.village({ t: 'call.start', agent, callId, student: viewer.studentId });

    // a call whose websocket never connects must not hold the student's slot forever
    const reaper = setTimeout(() => {
      if (!connectedCalls.has(callId)) void hangUp(deps, callId);
    }, UNCONNECTED_MS);
    reaper.unref?.();

    const wsBase = deps.config.baseUrl.replace(/^http/, 'ws');
    const { token } = signToken(
      deps.config.authSecret,
      { kind: 'call', sub: viewer.studentId, ttlMs: TICKET_TTL, call: callId },
      deps.now(),
    );
    return c.json({ callId, wsUrl: `${wsBase}/v1/call/ws/${callId}`, ticket: token });
  });

  return r;
}
