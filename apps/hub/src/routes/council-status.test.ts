import { createCouncilAgents, createCouncilService } from '@squad/brain';
import {
  CouncilRunsResponseSchema,
  CouncilStatusSchema,
  FakeLlm,
  recordCouncilRunMeta,
  registerCouncilRun,
  type VillageEvent,
} from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { afterEach, describe, expect, it } from 'vitest';
import { createHub } from '../app';
import { signToken } from '../auth';
import { createCouncilRunStore, KEEP_PER_SQUAD } from '../council/run-store';
import type { Viewer } from '../types';

const SECRET = 'status-test';
const KEY = 'AIzaSyTESTSENTINEL_not_a_real_key_0123456789';
const tok = (sub: string) => signToken(SECRET, { kind: 'bearer', sub, ttlMs: 60_000 }).token;
const v = (studentId: string, squadId: string): Viewer => ({
  studentId,
  squadId,
  projector: false,
});

function setup(runtime?: { llm(): { llm: 'real' | 'fake'; reason?: string } }) {
  const hub = createHub({
    config: { seed: false, sim: false, authSecret: SECRET, logLevel: 'silent' },
  });
  const d = hub.deps.directory;
  for (const id of ['s_ana', 's_ben', 's_zed']) d.upsertStudent({ id, name: id, handle: id });
  d.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana', 's_ben'] });
  d.upsertSquad({ id: 'sq2', name: 'sq2', members: ['s_zed'] });
  if (runtime) hub.deps.runtime = runtime as never;
  const emit = (e: VillageEvent): void => void hub.deps.ingest.village(e);
  hub.deps.council = createCouncilService({
    llm: new FakeLlm(),
    db: openMemoryDb(),
    emit,
    agents: createCouncilAgents({ env: {}, emit }),
  });
  const get = (path: string, sub: string) =>
    hub.app.request(path, { headers: { authorization: `Bearer ${tok(sub)}` } });
  return { hub, get };
}

const saved = process.env.GEMINI_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved;
});

describe('GET /v1/council/status', () => {
  it('requires auth', async () => {
    const { hub } = setup();
    expect((await hub.app.request('/v1/council/status')).status).toBe(401);
  });

  it('has provider, models, transports and no secrets, whatever the environment holds', async () => {
    process.env.GEMINI_API_KEY = KEY;
    process.env.INTERNAL_EVENTS_SECRET = 'internal-secret-sentinel-xyz';
    const { get } = setup();
    const res = await get('/v1/council/status', 's_ana');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('AIza');
    expect(text).not.toContain('internal-secret-sentinel-xyz');
    expect(text).not.toMatch(/api[_-]?key"?\s*:/i);
    const s = CouncilStatusSchema.parse(JSON.parse(text));
    expect(s.provider).toBe('Google Gemini');
    expect(s.key.state).toBe('ok');
    expect(s.models.main).toMatch(/^gemini-/);
    expect(s.transports.live.state).toBe('untested');
    expect(s.transports.live.enabled).toBe(true);
    expect(s.defaultTransport).toBe('stream');
    delete process.env.INTERNAL_EVENTS_SECRET;
  });

  it('no key: no_key with the exact fix, and the stream label is Demo', async () => {
    delete process.env.GEMINI_API_KEY;
    const { get } = setup();
    const s = CouncilStatusSchema.parse(await (await get('/v1/council/status', 's_ana')).json());
    expect(s.key).toEqual({
      state: 'no_key',
      fix: 'Set GEMINI_API_KEY in the hub environment, then restart the hub.',
    });
    expect(s.transports.stream).toEqual({ available: false, label: 'Demo (scripted, not Gemini)' });
    expect(s.transports.live.enabled).toBe(false);
  });

  it.each([
    ['credits_depleted', 'credits_depleted'],
    ['rate_limited', 'rate_limited'],
  ] as const)('key state %s follows the hub health', async (reason, state) => {
    process.env.GEMINI_API_KEY = KEY;
    const { get } = setup({ llm: () => ({ llm: 'fake', reason }) });
    const s = CouncilStatusSchema.parse(await (await get('/v1/council/status', 's_ana')).json());
    expect(s.key.state).toBe(state);
    expect(s.key.fix.length).toBeGreaterThan(20);
  });

  it('counts A2A messages and delegations of stored runs', async () => {
    process.env.GEMINI_API_KEY = KEY;
    const { hub, get } = setup();
    await hub.deps.council!.ask({
      question: 'Is B or A right?',
      askedBy: 's_ana',
      chatId: 'group:sq',
    }).done;
    const s = CouncilStatusSchema.parse(await (await get('/v1/council/status', 's_ben')).json());
    expect(s.a2a.runs).toBe(1);
    expect(s.a2a.messages).toBeGreaterThan(6);
    expect(s.a2a.delegations).toBe(3);
    expect(s.a2a.lastStage).toBe('done');
  });
});

describe('GET /v1/council/runs (persisted runs, viewer filtered)', () => {
  it('stores the last council with hierarchy, thread, actions, transport and mode', async () => {
    const { hub, get } = setup();
    const h = hub.deps.council!.ask({
      question: 'Is B or A right?',
      askedBy: 's_ana',
      chatId: 'group:sq',
    });
    await h.done;
    const res = await get('/v1/council/runs', 's_ben'); // a squadmate
    const { runs } = CouncilRunsResponseSchema.parse(await res.json());
    expect(runs).toHaveLength(1);
    const r = runs[0]!;
    expect(r).toMatchObject({
      id: h.id,
      councilKey: 'ask',
      question: 'Is B or A right?',
      status: 'done',
      stage: 'done',
      private: false,
    });
    expect(r.mode.startsWith('demo')).toBe(true);
    expect(r.transport).toMatchObject({ kind: 'demo', label: 'Demo (scripted, not Gemini)' });
    expect(r.agents.map((a) => a.displayName)).toEqual([
      'Chair',
      'Skeptic',
      'Teacher',
      'Practitioner',
    ]);
    expect(r.messages.length).toBeGreaterThan(6);
    expect(r.messages.some((m) => m.kind === 'delegate')).toBe(true);
    expect(r.counters.delegations).toBe(3);
    expect(r.actions.length).toBeGreaterThan(0);
    expect(r.result?.id).toBe(h.id);
    // another squad sees nothing
    const other = CouncilRunsResponseSchema.parse(
      await (await get('/v1/council/runs', 's_zed')).json(),
    );
    expect(other.runs).toEqual([]);
  });

  it('a private (DM) run: the asker sees all, a squadmate only skeleton arrows', async () => {
    const { hub, get } = setup();
    const h = hub.deps.council!.ask({
      question: 'my secret question about therapy',
      askedBy: 's_ana',
      chatId: 'dm:s_ana',
    });
    await h.done;
    const ana = CouncilRunsResponseSchema.parse(
      await (await get('/v1/council/runs', 's_ana')).json(),
    ).runs[0]!;
    expect(ana.question).toContain('secret question');
    expect(ana.result).toBeDefined();
    const ben = CouncilRunsResponseSchema.parse(
      await (await get('/v1/council/runs', 's_ben')).json(),
    ).runs[0]!;
    expect(ben.private).toBe(true);
    expect(ben.question).toBe('');
    expect(ben.result).toBeUndefined();
    expect(ben.actions).toEqual([]);
    expect(ben.messages.length).toBeGreaterThan(0);
    for (const m of ben.messages) {
      expect(m.summary).toBeUndefined();
      expect(m.answer).toBeUndefined();
      expect(m.stance).toBeUndefined();
    }
    expect(JSON.stringify(ben)).not.toMatch(/therapy|secret question/);
  });

  it('survives a restart: the owner and the run come back from the database', async () => {
    const db = openMemoryDb();
    const hub = createHub({
      config: { seed: false, sim: false, authSecret: SECRET, logLevel: 'silent' },
    });
    const d = hub.deps.directory;
    d.upsertStudent({ id: 's_ana', name: 'a', handle: 'a' });
    d.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana'] });
    const first = createCouncilRunStore(
      db,
      () => hub.deps.filterCtx,
      (s) => d.squadOf(s as never),
    );
    registerCouncilRun('cn_aaaaaaaaaaaa', { askedBy: 's_ana', private: false });
    recordCouncilRunMeta('cn_aaaaaaaaaaaa', {
      councilKey: 'roundtable',
      question: 'Plan my fall',
      transport: { kind: 'stream-text', label: 'Gemini streaming text' },
      roster: [{ id: 'council:roundtable-chairman', role: 'chair', displayName: 'Chairman' }],
      startedAt: 5,
    });
    first.observe({
      t: 'council.stage',
      councilId: 'council:roundtable',
      correlationId: 'cn_aaaaaaaaaaaa',
      stage: 'done',
      mode: 'live',
    });
    const second = createCouncilRunStore(
      db,
      () => hub.deps.filterCtx,
      (s) => d.squadOf(s as never),
    );
    expect(second.ownerOf('cn_aaaaaaaaaaaa')).toEqual({
      askedBy: 's_ana',
      squadId: 'sq',
      private: false,
    });
    const [r] = second.list(v('s_ana', 'sq'), { councilKey: 'roundtable' });
    expect(r).toMatchObject({ councilKey: 'roundtable', question: 'Plan my fall', status: 'done' });
    expect(second.list(v('s_ana', 'sq'), { councilKey: 'ask' })).toEqual([]);
  });

  it(`keeps only the last ${KEEP_PER_SQUAD} runs per squad`, () => {
    const db = openMemoryDb();
    const hub = createHub({
      config: { seed: false, sim: false, authSecret: SECRET, logLevel: 'silent' },
    });
    const d = hub.deps.directory;
    d.upsertStudent({ id: 's_ana', name: 'a', handle: 'a' });
    d.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana'] });
    let t = 1000;
    const store = createCouncilRunStore(
      db,
      () => hub.deps.filterCtx,
      (s) => d.squadOf(s as never),
      () => t++,
    );
    for (let i = 0; i < 25; i++) {
      const id = `cn_${String(i).padStart(12, 'a')}`;
      registerCouncilRun(id, { askedBy: 's_ana', private: false });
      store.observe({
        t: 'council.stage',
        councilId: 'council:ask',
        correlationId: id,
        stage: 'question',
        mode: 'live',
      });
    }
    const runs = store.list(v('s_ana', 'sq'));
    expect(runs).toHaveLength(KEEP_PER_SQUAD);
    expect(runs[0]!.id).toBe(`cn_${String(24).padStart(12, 'a')}`);
    expect(store.stats().runs).toBe(KEEP_PER_SQUAD);
  });
});
