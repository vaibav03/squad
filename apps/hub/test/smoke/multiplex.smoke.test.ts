import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunningHub } from '../../src/server';
import { boot, emit, login, openSse, post } from '../helpers';

/**
 * GET /v1/stream: squad + chat on one connection. The privacy contract is equivalence with the two legacy streams
 * (same per-viewer filtering), plus composite resume, heartbeat, auth and the per-user cap.
 */
let hub: RunningHub;
let url: string;
const tok: Record<string, string> = {};
type Sse = Awaited<ReturnType<typeof openSse>>;
const open: Sse[] = [];

interface Mux {
  ch: string;
  event: string;
  id?: number;
  data: unknown;
}
const muxOf = (s: Sse): Mux[] =>
  s.frames.filter((f) => f.data && !f.event).map((f) => JSON.parse(f.data!) as Mux);
const stOf = async (id: string) =>
  (await post<{ st: string }>(url, '/v1/squad/stream-token', {}, tok[id])).body.st;
const track = (s: Sse) => (open.push(s), s);
const legacy = async (id: string, path: string) =>
  track(await openSse(url, { st: await stOf(id), path }));
const mux = async (id: string, query = '') =>
  track(await openSse(url, { st: await stOf(id), path: '/v1/stream', query }));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canonical strings of the squad events and chat messages a stream delivered. */
const legacySet = (squad: Sse, chat: Sse): string[] => [
  ...squad.frames
    .filter((f) => f.id && f.event && f.event !== 'x.resync')
    .map((f) => `squad|${f.id}|${f.event}|${f.data}`),
  ...chat.frames
    .filter((f) => f.event === 'chat.message')
    .map((f) => `chat|${f.id}|chat.message|${f.data}`),
];
const muxSet = (m: Sse): string[] =>
  muxOf(m)
    .filter((x) => (x.ch === 'squad' && x.event !== 'x.resync') || x.event === 'chat.message')
    .map((x) => `${x.ch}|${x.id}|${x.event}|${JSON.stringify(x.data)}`);

const send = (as: string, chatId: string, text: string) =>
  post(url, '/v1/chat/send', { chatId, text }, tok[as]);
const state = (id: string, s: string) =>
  emit(url, { t: 'agent.state', agent: `student:${id}`, state: s });

beforeAll(async () => {
  hub = await boot({ sse: { bufferSize: 5000, maxQueue: 256, pingMs: 150 } });
  url = hub.url;
  hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed@demo.test' });
  hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
  hub.deps.directory.upsertStudent({ id: 's_loner', name: 'Loner', handle: 'loner@demo.test' });
  for (const id of ['s_ana', 's_ben', 's_zed', 's_loner']) tok[id] = await login(url, id);
}, 60_000);
afterAll(async () => {
  for (const s of open) s.stop();
  await hub.stop();
});

describe('/v1/stream', () => {
  it('sends the preamble, hello and real heartbeat frames', async () => {
    const s = await mux('s_ana');
    await s.waitFor((f) => muxOf({ frames: f } as Sse).filter((x) => x.event === 'hb').length >= 2);
    const frames = muxOf(s);
    expect(frames[0]).toMatchObject({
      ch: 'sys',
      event: 'hello',
      data: { channels: ['squad', 'chat'], pingMs: 150, retryMs: 2000 },
    });
    const cur = (frames[0]!.data as { cursor: { squad: number; chat: number } }).cursor;
    expect(cur).toEqual({ squad: hub.deps.events.lastSeq(), chat: hub.deps.chat.store.lastSeq() });
    const hb = frames.find((x) => x.event === 'hb')!;
    expect(hb.ch).toBe('sys');
    expect(typeof (hb.data as { ts: number }).ts).toBe('number');
    expect(s.res.headers.get('content-type')).toContain('text/event-stream');
    s.stop();
  });

  it('privacy: each viewer gets exactly the union of the two legacy streams, squads never mix', async () => {
    const who = ['s_ana', 's_ben', 's_zed'];
    const L: Record<string, { squad: Sse; chat: Sse }> = {};
    const M: Record<string, Sse> = {};
    for (const id of who) {
      L[id] = {
        squad: await legacy(id, '/v1/squad/stream'),
        chat: await legacy(id, '/v1/chat/stream'),
      };
      M[id] = await mux(id);
    }
    await state('s_ana', 'studying');
    await send('s_ana', 'group:sq_demo', 'hello squad A');
    await send('s_ana', 'dm:s_ana', 'private note to myself');
    await state('s_zed', 'studying');
    await send('s_zed', 'group:sq_other', 'hello squad B');
    await send('s_zed', 'dm:s_zed', 'zed private');
    await state('s_ben', 'idle');
    const settled = () =>
      who.every((id) => {
        const l = legacySet(L[id]!.squad, L[id]!.chat);
        return l.length >= 3 && muxSet(M[id]!).length === l.length;
      });
    await M.s_ana!.waitFor(settled, 5000);
    for (const id of who) {
      expect(new Set(muxSet(M[id]!)), id).toEqual(new Set(legacySet(L[id]!.squad, L[id]!.chat)));
    }
    const text = (id: string) => muxSet(M[id]!).join('\n');
    expect(text('s_ana')).toContain('hello squad A');
    expect(text('s_ana')).toContain('private note to myself');
    expect(text('s_ana')).not.toContain('zed');
    expect(text('s_ana')).not.toContain('hello squad B');
    expect(text('s_ben')).toContain('hello squad A');
    expect(text('s_ben')).not.toContain('private note to myself');
    expect(text('s_zed')).toContain('hello squad B');
    expect(text('s_zed')).not.toContain('hello squad A');
    expect(text('s_zed')).not.toContain('private note to myself');
    // squad and chat events interleave on the one connection
    const chs = muxOf(M.s_ana!).map((x) => x.ch);
    expect(chs).toContain('squad');
    expect(chs).toContain('chat');
    for (const s of Object.values(M)) s.stop();
  });

  it('resumes both channels from the composite Last-Event-ID', async () => {
    const a = await mux('s_ana');
    await state('s_ana', 'in_call');
    await send('s_ana', 'group:sq_demo', 'before resume');
    await a.waitFor(() => muxSet(a).some((x) => x.includes('before resume')), 5000);
    const lastId = [...a.frames].reverse().find((f) => f.id)!.id!;
    expect(lastId).toMatch(/^\d+:\d+$/);
    a.stop();
    await state('s_ana', 'waiting_for_student');
    await send('s_ana', 'group:sq_demo', 'after resume');
    const b = await mux('s_ana', `&lastEventId=${encodeURIComponent(lastId)}`);
    await b.waitFor(() => muxSet(b).some((x) => x.includes('after resume')), 5000);
    await wait(200);
    const got = muxSet(b);
    expect(got.some((x) => x.startsWith('squad|') && x.includes('waiting_for_student'))).toBe(true);
    expect(got.join('\n')).not.toContain('before resume');
    expect(got.filter((x) => x.includes('in_call'))).toEqual([]);
    // the frame id keeps advancing as a composite cursor
    expect([...b.frames].reverse().find((f) => f.id)!.id).toMatch(/^\d+:\d+$/);
    b.stop();
    // a plain number is squad only; squadLast / chatLast override the cursor sides
    const [sq, ch] = lastId.split(':');
    const c = await mux('s_ana', `&lastEventId=${sq}&chatLast=${ch}`);
    await c.waitFor(() => muxSet(c).some((x) => x.includes('after resume')), 5000);
    c.stop();
  });

  it('answers x.resync / chat.resync when the cursor is too old or ahead', async () => {
    const h = await boot({ sse: { bufferSize: 3, maxQueue: 256, pingMs: 5000 } });
    try {
      const t = await login(h.url, 's_ana');
      for (let i = 0; i < 8; i++)
        await emit(h.url, { t: 'agent.state', agent: 'student:s_ana', state: `s${i}` });
      const st = (await post<{ st: string }>(h.url, '/v1/squad/stream-token', {}, t)).body.st;
      const s = await openSse(h.url, { st, path: '/v1/stream', query: '&lastEventId=1:99999' });
      await s.waitFor((f) => {
        const m = muxOf({ frames: f } as Sse);
        return m.some((x) => x.event === 'x.resync') && m.some((x) => x.event === 'chat.resync');
      }, 5000);
      const m = muxOf(s);
      expect(m.find((x) => x.event === 'x.resync')).toMatchObject({ ch: 'squad' });
      expect(m.find((x) => x.event === 'chat.resync')).toMatchObject({ ch: 'chat' });
      s.stop();
    } finally {
      await h.stop();
    }
  });

  it('subscribes only the requested channels', async () => {
    const s = await mux('s_ana', '&channels=squad,bogus');
    await state('s_ana', 'studying');
    await send('s_ana', 'group:sq_demo', 'only squad please');
    await s.waitFor((f) => f.some((x) => x.data?.includes('"ch":"squad"')), 5000);
    await wait(200);
    expect(muxOf(s)[0]).toMatchObject({ event: 'hello', data: { channels: ['squad'] } });
    const hc = (muxOf(s)[0]!.data as { cursor: object }).cursor;
    expect(Object.keys(hc)).toEqual(['squad']);
    expect(muxOf(s).some((x) => x.ch === 'chat')).toBe(false);
    s.stop();
    const bad = await fetch(`${url}/v1/stream?st=${await stOf('s_ana')}&channels=nope`);
    expect(bad.status).toBe(400);
  });

  it('denies unauthenticated and non-member viewers like the legacy streams', async () => {
    for (const path of ['/v1/squad/stream', '/v1/stream']) {
      expect((await fetch(`${url}${path}`)).status, path).toBe(401);
      // a long-lived bearer is not accepted in the query
      expect((await fetch(`${url}${path}?st=${tok.s_ana}`)).status, path).toBe(401);
    }
    const st = await stOf('s_loner');
    const legacyStatus = (await fetch(`${url}/v1/squad/stream?st=${st}`)).status;
    const muxStatus = (await fetch(`${url}/v1/stream?st=${st}`)).status;
    expect(legacyStatus).toBeGreaterThanOrEqual(400);
    expect(muxStatus).toBe(legacyStatus);
    const bearer = await fetch(`${url}/v1/stream`, {
      headers: { authorization: `Bearer ${tok.s_ana}` },
    });
    expect(bearer.status).toBe(200);
    void bearer.body?.cancel();
  });
});

describe('/v1/stream cap', () => {
  it('429 with Retry-After at the per-user cap, on both paths', async () => {
    const h = await boot({}, { security: { maxStreamsPerUser: 2 } });
    try {
      const t = await login(h.url, 's_ana');
      const st = async () =>
        (await post<{ st: string }>(h.url, '/v1/squad/stream-token', {}, t)).body.st;
      const ac = new AbortController();
      const get = async (path: string) =>
        fetch(`${h.url}${path}?st=${await st()}${path === '/v1/stream' ? '&channels=squad' : ''}`, {
          signal: ac.signal,
        });
      const a = await get('/v1/stream');
      const b = await get('/v1/squad/stream');
      expect([a.status, b.status]).toEqual([200, 200]);
      for (const path of ['/v1/stream', '/v1/squad/stream']) {
        const c = await get(path);
        expect(c.status, path).toBe(429);
        expect(Number(c.headers.get('retry-after'))).toBeGreaterThan(0);
        expect(await c.json()).toMatchObject({ error: { code: 'rate_limited' } });
      }
      ac.abort();
    } finally {
      await h.stop();
    }
  });
});
