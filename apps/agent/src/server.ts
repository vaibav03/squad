import { Hono } from 'hono';
import { z } from 'zod';
import type { AskConfirm, Llm } from '@squad/core';
import {
  agentCard,
  createAgent,
  type Emitter,
  type FlowAgent,
  type Net,
  type PrivateProfile,
} from '@squad/mesh';
import type { HubPort, Ledger } from '@squad/mesh';

export interface AgentAppOptions {
  profile: PrivateProfile;
  net: Net;
  emitter: Emitter;
  askConfirm: AskConfirm;
  llm: Llm;
  url: string;
  secret: string; // INTERNAL_EVENTS_SECRET: guards /internal/*
  seed?: string;
  ledger?: Ledger;
  hub?: HubPort;
  timeouts?: { peerMs?: number; confirmMs?: number };
  log?: (line: string) => void;
}

const MAX_BODY = 256_000;
const Id = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const Win = z.strictObject({ from: z.string(), to: z.string() });
const StudyStart = z.strictObject({
  taskId: Id,
  members: z.array(Id).min(2).max(12),
  window: Win,
  examAt: z.string().optional(),
  topics: z.array(Id).max(16).optional(),
  squadId: Id.optional(),
});
const CalendarPut = z.strictObject({
  events: z
    .array(
      z.strictObject({
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/),
        title: z.string().max(200),
      }),
    )
    .max(2000),
});
const TripStart = z.strictObject({
  taskId: Id,
  members: z.array(Id).min(2).max(12),
  window: Win,
  squadId: Id,
  options: z
    .array(
      z.strictObject({
        id: Id,
        label: Id,
        days: z.number().int().min(1).max(14),
        perPerson: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(12),
});

export function createAgentApp(o: AgentAppOptions): { app: Hono; agent: FlowAgent } {
  const agent = createAgent({
    profile: o.profile,
    net: o.net,
    emitter: o.emitter,
    askConfirm: o.askConfirm,
    llm: o.llm,
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
    ...(o.ledger ? { ledger: o.ledger } : {}),
    ...(o.hub ? { hub: o.hub } : {}),
    ...(o.timeouts ? { timeouts: o.timeouts } : {}),
    ...(o.log ? { log: o.log } : {}),
  });
  const app = new Hono();

  app.get('/healthz', (c) => c.json({ ok: true, agent: o.profile.id }));
  app.get('/.well-known/agent.json', (c) =>
    c.json(agentCard({ id: o.profile.id, name: o.profile.name, url: o.url })),
  );

  app.post('/a2a', async (c) => {
    const text = await c.req.text();
    if (text.length > MAX_BODY)
      return c.json({ taskId: 'unknown', state: 'failed', error: 'too_large' }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return c.json({ taskId: 'unknown', state: 'failed', error: 'bad_json' }, 400);
    }
    const reply = await agent.handle(raw); // never throws; errors are fixed codes, never values
    return c.json(reply, reply.state === 'failed' ? 422 : 200);
  });

  const guard = (header: string | undefined): boolean => o.secret.length > 0 && header === o.secret;

  app.post('/internal/start/study', async (c) => {
    if (!guard(c.req.header('X-Nook-Internal'))) return c.json({ error: 'forbidden' }, 403);
    const p = StudyStart.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'bad_request' }, 400);
    const d = p.data;
    return c.json(
      await agent.startStudy({
        taskId: d.taskId,
        members: d.members,
        window: d.window,
        ...(d.examAt ? { examAt: d.examAt } : {}),
        ...(d.topics ? { topics: d.topics } : {}),
        ...(d.squadId ? { squadId: d.squadId } : {}),
      }),
    );
  });
  app.post('/internal/start/trip', async (c) => {
    if (!guard(c.req.header('X-Nook-Internal'))) return c.json({ error: 'forbidden' }, 403);
    const p = TripStart.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'bad_request' }, 400);
    return c.json(await agent.startTrip(p.data));
  });
  // Calendar import from the hub: replaces this student's busy blocks (the profile is read live by every flow).
  app.post('/internal/calendar', async (c) => {
    if (!guard(c.req.header('X-Nook-Internal'))) return c.json({ error: 'forbidden' }, 403);
    const p = CalendarPut.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'bad_request' }, 400);
    o.profile.calendar.splice(0, o.profile.calendar.length, ...p.data.events);
    return c.json({ ok: true, blocks: o.profile.calendar.length });
  });
  app.post('/internal/query', async (c) => {
    if (!guard(c.req.header('X-Nook-Internal'))) return c.json({ error: 'forbidden' }, 403);
    const p = z
      .strictObject({
        about: z.enum(['budget', 'calendar', 'hardNo', 'weakTopic']),
        target: Id,
        taskId: Id,
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: 'bad_request' }, 400);
    return c.json({ result: await agent.askPeer(p.data.about, p.data.target, p.data.taskId) });
  });

  return { app, agent };
}
