import type { CouncilService } from '@squad/brain';
import {
  CouncilAskResponseSchema,
  CouncilResultSchema,
  SENTINELS,
  type CouncilResult,
} from '@squad/core';
import { describe, expect, it } from 'vitest';
import { createHub, type Hub } from '../app';
import { signToken } from '../auth';

const SECRET = 'auth-test';

/** Hand-written service: runs stay 'running' until `finish` is called. */
function fakeService() {
  const runs = new Map<string, CouncilResult>();
  const subs = new Map<string, Set<(r: CouncilResult) => void>>();
  let n = 0;
  let busy: 'busy' | 'rate_limited' | undefined;
  const push = (id: string) => {
    const r = runs.get(id)!;
    for (const fn of subs.get(id) ?? []) fn({ ...r });
  };
  const svc: CouncilService = {
    demo: true,
    ask(i) {
      if (busy) {
        const e = new Error(busy);
        e.name = 'CouncilBusyError';
        Object.assign(e, { code: busy });
        throw e;
      }
      const id = `cn_${String(++n).padStart(12, '0')}`;
      const r: CouncilResult = {
        id,
        question: i.question,
        status: 'running',
        phase: 'opinions',
        grounding: 'none',
        notes: [],
        members: [],
        rankings: [],
        visibility: i.visibility ?? (i.chatId?.startsWith('dm:') ? 'private' : 'squad'),
        askedBy: i.askedBy,
        demo: true,
        startedAt: 1,
      };
      runs.set(id, r);
      return { id, result: () => ({ ...r }), done: Promise.resolve(r) };
    },
    get: (id) => runs.get(id),
    subscribe(id, fn) {
      const r = runs.get(id);
      if (!r) return undefined;
      const set = subs.get(id) ?? new Set();
      subs.set(id, set);
      set.add(fn);
      fn({ ...r });
      return () => void set.delete(fn);
    },
  };
  return {
    svc,
    subs,
    setBusy: (b: typeof busy) => (busy = b),
    step(id: string, patch: Partial<CouncilResult>) {
      Object.assign(runs.get(id)!, patch);
      push(id);
    },
  };
}

function setup() {
  const hub: Hub = createHub({
    config: { seed: true, sim: false, authSecret: SECRET, logLevel: 'silent' },
  });
  const fake = fakeService();
  hub.deps.council = fake.svc;
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  const tok = (sub: string, kind: 'bearer' | 'stream' = 'bearer') =>
    signToken(SECRET, { kind, sub, ttlMs: 60_000 }).token;
  const call = (path: string, sub: string | null, body?: unknown, raw?: string) =>
    hub.app.request(path, {
      method: body !== undefined || raw !== undefined ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        ...(sub ? { authorization: `Bearer ${tok(sub)}` } : {}),
      },
      ...(raw !== undefined
        ? { body: raw }
        : body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
    });
  const ask = async (sub: string, body: unknown) => {
    const res = await call('/v1/council/ask', sub, body);
    return { res, json: (await res.json()) as { id: string } };
  };
  return { hub, fake, tok, call, ask };
}

async function readFrames(res: Response) {
  const text = await res.text();
  return text
    .split('\n\n')
    .map((raw) => {
      const f: Record<string, string> = {};
      for (const line of raw.split('\n')) {
        const i = line.indexOf(': ');
        if (i > 0) f[line.slice(0, i)] = line.slice(i + 2);
      }
      return f;
    })
    .filter((f) => f.event);
}

describe('POST /v1/council/ask', () => {
  it('requires auth', async () => {
    const { call } = setup();
    expect((await call('/v1/council/ask', null, { question: 'what is x?' })).status).toBe(401);
  });

  it('accepts a question with 202 and a contract-valid body', async () => {
    const { ask } = setup();
    const { res, json } = await ask('s_ana', { question: 'Is a bond price inverse to yield?' });
    expect(res.status).toBe(202);
    const body = CouncilAskResponseSchema.parse(json);
    expect(body.streamUrl).toBe(`/v1/council/${body.id}/stream`);
    expect(body.resultUrl).toBe(`/v1/council/${body.id}`);
  });

  it('validates the body (400 invalid_request)', async () => {
    const { call } = setup();
    for (const b of [{}, { question: 'x' }, { question: 'ok question', extra: 1 }]) {
      const r = await call('/v1/council/ask', 's_ana', b);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: { code: 'invalid_request' } });
    }
    expect((await call('/v1/council/ask', 's_ana', undefined, 'not json')).status).toBe(400);
  });

  it('refuses bodies over 4 KB', async () => {
    const { call } = setup();
    const r = await call(
      '/v1/council/ask',
      's_ana',
      undefined,
      JSON.stringify({ question: 'a'.repeat(5000) }),
    );
    expect(r.status).toBe(413);
  });

  it('403 for a chat that is not the viewer squad group or own dm', async () => {
    const { ask } = setup();
    for (const chatId of ['group:sq_other', 'dm:s_ben', 'group:nope']) {
      const { res } = await ask('s_ana', { question: 'what is x?', chatId });
      expect(res.status).toBe(403);
    }
    expect(
      (await ask('s_ana', { question: 'what is x?', chatId: 'group:sq_demo' })).res.status,
    ).toBe(202);
    expect((await ask('s_ana', { question: 'what is x?', chatId: 'dm:s_ana' })).res.status).toBe(
      202,
    );
  });

  it('maps CouncilBusyError to 429', async () => {
    const { fake, call } = setup();
    for (const code of ['busy', 'rate_limited'] as const) {
      fake.setBusy(code);
      const r = await call('/v1/council/ask', 's_ana', { question: 'what is x?' });
      expect(r.status).toBe(429);
      expect(await r.json()).toEqual({ error: { code } });
    }
  });

  it('a dm chat makes the run private', async () => {
    const { ask, call } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?', chatId: 'dm:s_ana' });
    const got = CouncilResultSchema.parse(
      await (await call(`/v1/council/${json.id}`, 's_ana')).json(),
    );
    expect(got.visibility).toBe('private');
  });
});

describe('GET /v1/council/:id', () => {
  it('returns the snapshot, no-store, schema-valid', async () => {
    const { ask, call } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?' });
    const r = await call(`/v1/council/${json.id}`, 's_ben'); // squad run: teammates may read
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(CouncilResultSchema.parse(await r.json()).id).toBe(json.id);
  });

  it('404 for unknown ids, malformed ids, other squads and private runs of others', async () => {
    const { ask, call } = setup();
    const pub = await ask('s_ana', { question: 'what is x?' });
    const priv = await ask('s_ana', { question: 'what is x?', chatId: 'dm:s_ana' });
    const cases: [string, string][] = [
      ['/v1/council/cn_zzzzzzzzzzzz', 's_ana'],
      ['/v1/council/nope', 's_ana'],
      [`/v1/council/${pub.json.id}`, 's_zed'],
      [`/v1/council/${priv.json.id}`, 's_ben'],
      [`/v1/council/${priv.json.id}`, 's_zed'],
    ];
    for (const [path, who] of cases) {
      const r = await call(path, who);
      expect(r.status, path + who).toBe(404);
      expect(await r.json()).toEqual({ error: { code: 'not_found' } });
    }
    expect((await call(`/v1/council/${priv.json.id}`, 's_ana')).status).toBe(200);
  });

  it('never leaks content when the stored result is invalid (500)', async () => {
    const { ask, call, fake } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?' });
    fake.step(json.id, { phase: 'bogus' as never });
    const r = await call(`/v1/council/${json.id}`, 's_ana');
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain('what is x');
  });
});

describe('GET /v1/council/:id/stream', () => {
  it('requires auth and hides other squads', async () => {
    const { ask, hub, tok } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?' });
    const anon = await hub.app.request(`/v1/council/${json.id}/stream`);
    expect(anon.status).toBe(401);
    const other = await hub.app.request(
      `/v1/council/${json.id}/stream?st=${tok('s_zed', 'stream')}`,
    );
    expect(other.status).toBe(404);
  });

  it('emits council.step snapshots then council.done and closes', async () => {
    const { ask, hub, tok, fake } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?' });
    const res = await hub.app.request(`/v1/council/${json.id}/stream?st=${tok('s_ben', 'stream')}`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    fake.step(json.id, { phase: 'rankings' });
    fake.step(json.id, { phase: 'done', status: 'done', finishedAt: 2 });
    const text = await res.clone().text(); // resolves only if the stream closed
    expect(text.startsWith('retry: 2000')).toBe(true);
    const frames = await readFrames(res);
    expect(frames.map((f) => f.event)).toEqual([
      'council.step',
      'council.step',
      'council.step',
      'council.done',
    ]);
    expect(frames.map((f) => f.id)).toEqual(['1', '2', '3', '4']);
    for (const f of frames) expect(CouncilResultSchema.parse(JSON.parse(f.data!)).id).toBe(json.id);
    expect(JSON.parse(frames.at(-1)!.data!).status).toBe('done');
    expect(fake.subs.get(json.id)!.size).toBe(0);
  });

  it('an already finished run sends one step and done, then ends', async () => {
    const { ask, hub, tok, fake } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?' });
    fake.step(json.id, { status: 'refused', phase: 'done', message: 'no' });
    const res = await hub.app.request(`/v1/council/${json.id}/stream?st=${tok('s_ana', 'stream')}`);
    expect((await readFrames(res)).map((f) => f.event)).toEqual(['council.step', 'council.done']);
  });

  it('unsubscribes when the client aborts', async () => {
    const { ask, hub, tok, fake } = setup();
    const { json } = await ask('s_ana', { question: 'what is x?' });
    const res = await hub.app.request(`/v1/council/${json.id}/stream?st=${tok('s_ana', 'stream')}`);
    const reader = res.body!.getReader();
    await reader.read();
    expect(fake.subs.get(json.id)!.size).toBe(1);
    await reader.cancel();
    expect(fake.subs.get(json.id)!.size).toBe(0);
  });
});

describe('privacy (sentinels)', () => {
  it('a private run is invisible to teammates over GET and stream, body never contains the text', async () => {
    const { ask, call, hub, tok } = setup();
    const secret = `should I get ${SENTINELS[1]} about my ${SENTINELS[0]} budget?`;
    const { json } = await ask('s_ana', { question: secret, chatId: 'dm:s_ana' });
    for (const who of ['s_ben', 's_zed']) {
      const g = await call(`/v1/council/${json.id}`, who);
      expect(g.status).toBe(404);
      const gt = await g.text();
      for (const s of SENTINELS) expect(gt).not.toContain(s);
      const s = await hub.app.request(`/v1/council/${json.id}/stream?st=${tok(who, 'stream')}`);
      expect(s.status).toBe(404);
      const st = await s.text();
      for (const x of SENTINELS) expect(st).not.toContain(x);
    }
  });
});
