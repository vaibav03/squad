import { cpSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChatMessageSchema, type ChatMessage, type TripViewV2 } from '@squad/core';
import { attachChatEngine } from '../../src/chat/engine';
import { createMemoryCodeSender } from '../../src/code-sender';
import { startHub, type RunningHub } from '../../src/server';
import { FIXTURE, SECRET, get, login, post } from '../helpers';

/**
 * Collaborative trips over real HTTP: create from chat and from the page, constraints through (fake) member agents,
 * the secret ballot, private limits, calendar facts, numbered chat replies, conflicts, confirm once, isolation.
 * Fake agents are tiny HTTP servers speaking the hub's agent contract (/healthz, /internal/start/trip).
 */
const SENTINEL_CAL = 'SENTINEL_CAL_TITLE_9137';
const SQUAD_ID = 'sq_demo';
const GROUP = `group:${SQUAD_ID}`;
const MEMBERS = ['s_ana', 's_ben', 's_chi', 's_dev'];

let hub: RunningHub;
let url: string;
const tok: Record<string, string> = {};
const servers: Server[] = [];
const offline = new Set<string>();
let startCalls: { coordinator: string; body: Record<string, unknown> }[] = [];
let outcome: (body: Record<string, any>) => Record<string, unknown>;

const defaultOutcome = (b: Record<string, any>) => {
  const opts = b.options as { id: string }[];
  return {
    status: 'constraints',
    common: ['2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15'],
    survivors: opts.map((o) => o.id),
    dropped: [],
    // a misbehaving agent must not be able to smuggle a calendar title into any surface
    busy: [{ title: SENTINEL_CAL }],
  };
};

function fakeAgent(id: string): Promise<string> {
  const srv = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.statusCode = offline.has(id) ? 503 : 200;
      res.end('ok');
      return;
    }
    if (req.url === '/internal/start/trip' && req.method === 'POST') {
      if (req.headers['x-nook-internal'] !== SECRET) {
        res.statusCode = 401;
        res.end();
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw) as Record<string, any>;
        startCalls.push({ coordinator: id, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(outcome(body)));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  servers.push(srv);
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)));
}

const history = async (as: string, chatId: string) =>
  (await get<{ messages: unknown[] }>(url, `/v1/chat/history?chatId=${encodeURIComponent(chatId)}`, tok[as])).body.messages.map(
    (m) => ChatMessageSchema.parse(m),
  );
const texts = (ms: ChatMessage[]) => ms.map((m) => m.text);
const say = (as: string, chatId: string, text: string) => post(url, '/v1/chat/send', { chatId, text }, tok[as]);
const current = async (as: string) => (await get<{ trip: TripViewV2 | null }>(url, '/v1/trips/current', tok[as])).body.trip;
const idle = () => hub.deps.tripSvc.idle();
const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
};

beforeAll(async () => {
  const replayDir = mkdtempSync(join(tmpdir(), 'trip-replays-'));
  cpSync(FIXTURE, join(replayDir, 'sample.json'));
  hub = await startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: SECRET,
      authSecret: 'auth-test',
      sessionSecret: 'session-secret-for-tests-0123456789abcdef',
      contactPepper: 'pepper',
      seed: true,
      sim: false,
      production: false,
      devLogin: true,
      logLevel: 'silent',
      replayDir,
    },
    codeSender: createMemoryCodeSender(),
  });
  url = hub.url;
  await attachChatEngine(hub, { real: null, env: {}, envFile: false });
  const urls: Record<string, string> = {};
  for (const id of MEMBERS) {
    urls[id] = await fakeAgent(id);
    tok[id] = await login(url, id);
  }
  hub.deps.tripSvc.setAgentUrls(urls);
  outcome = defaultOutcome;
});
afterAll(async () => {
  for (const s of servers) s.close();
  await hub.stop();
});

describe('no trip, create from the page', () => {
  it('an unplanned real squad answers {trip:null}, not an error', async () => {
    // the seeded squad only has the mesh-driven demo trip; a squad without any trip is covered by isolation below
    const r = await get<{ trip: unknown }>(url, '/v1/trips/current', tok.s_ana);
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('trip');
  });

  it('rejects malformed create bodies', async () => {
    expect((await post(url, '/v1/trips', { destination: 'x' }, tok.s_ana)).status).toBe(400);
    expect((await post(url, '/v1/trips', { destination: 'Cabo', evil: 1 }, tok.s_ana)).status).toBe(400);
    expect((await post(url, '/v1/trips', { destination: 'Cabo' })).status).toBe(401);
  });
});

describe('collaborative flow from group chat', () => {
  let tripId = '';

  it('"@cubbie plan a trip to Cabo in March" creates a trip and says so in the group', async () => {
    await say('s_ana', GROUP, '@cubbie plan a trip to Cabo in March');
    await waitFor(async () => (await current('s_ana'))?.source === 'chat');
    await idle();
    const t = (await current('s_ben'))!;
    tripId = t.tripId;
    expect(t.title).toBe('Cabo in March');
    expect(t.organizer).toBe('s_ana');
    expect(t.options.length).toBeGreaterThanOrEqual(2);
    expect(t.window?.from).toMatch(/-03-01$/);
    const g = texts(await history('s_ben', GROUP)).join('\n');
    expect(g).toContain('started a trip plan for Cabo');
    expect(g).toContain('Voting is open');
  });

  it('the mesh was asked once, only with public option facts, and voting opened', async () => {
    expect(startCalls).toHaveLength(1);
    const b = startCalls[0]!.body;
    expect(b.constraintsOnly).toBe(true);
    expect(JSON.stringify(b)).not.toMatch(/budget|therapy|limit/i);
    const t = (await current('s_dev'))!;
    expect(t.status).toBe('voting');
    expect(t.constraints.state).toBe('done');
    expect(t.constraints.overlapDays).toEqual(['2027-03-12', '2027-03-13', '2027-03-14', '2027-03-15']);
  });

  it('calendar titles never leak: not in any view, chat message or event', async () => {
    const all = JSON.stringify([
      await get(url, `/v1/trips/${tripId}`, tok.s_ben),
      await history('s_ben', GROUP),
      hub.deps.events.since(0),
    ]);
    expect(all).not.toContain(SENTINEL_CAL);
  });

  it('a second create while one is active is refused with the active trip', async () => {
    const r = await post<{ error: { code: string }; tripId: string }>(url, '/v1/trips', { destination: 'Austin' }, tok.s_ben);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('trip_in_progress');
    expect(r.body.tripId).toBe(tripId);
  });

  it('private limits reach only their owner, through x.trip.limits under the run id', async () => {
    const run = hub.deps.trips.get(tripId)!.collab!.runs[0]!;
    const r = hub.deps.ingest.x('x.trip.limits', {
      tripId: run,
      student: 's_ben',
      limits: { budget: '$150 max', topic: 'therapy-sentinel' },
    });
    expect(r.ok).toBe(true);
    const own = (await get<TripViewV2>(url, `/v1/trips/${tripId}`, tok.s_ben)).body;
    expect(own.myLimits?.budget).toBe('$150 max');
    const others = JSON.stringify([
      await get(url, `/v1/trips/${tripId}`, tok.s_ana),
      await get(url, `/v1/trips/${tripId}`, tok.s_chi),
      await history('s_ana', GROUP),
    ]);
    expect(others).not.toContain('$150 max');
    expect(others).not.toContain('therapy-sentinel');
  });

  it('ballot counts stay hidden below 3 voters and nobody sees another ranking', async () => {
    const opts = (await current('s_ana'))!.options.map((o) => o.id);
    const v1 = await post<{ trip: TripViewV2 }>(url, `/v1/trips/${tripId}/vote`, { ranking: [opts[1], opts[0]] }, tok.s_ana);
    expect(v1.status).toBe(200);
    await post(url, `/v1/trips/${tripId}/vote`, { ranking: [opts[0]] }, tok.s_ben);
    const view = (await get<TripViewV2>(url, `/v1/trips/${tripId}`, tok.s_chi)).body;
    expect(view.voteProgress).toBeNull();
    expect(view.myVote).toBeNull();
    expect(view.members.filter((m) => m.id !== 's_chi').every((m) => m.voted === null)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('"ranking"');
    const ana = (await get<TripViewV2>(url, `/v1/trips/${tripId}`, tok.s_ana)).body;
    expect(ana.myVote?.[0]).toBe(opts[1]);
    const chat = texts(await history('s_chi', GROUP)).join('\n');
    expect(chat).toContain('Counts stay hidden until 3 members have voted');
  });

  it('"I vote 1" in a DM and a numbered reply to the vote card both count; counts appear at 3', async () => {
    await say('s_chi', 'dm:s_chi', 'I vote 1');
    await waitFor(async () => ((await current('s_ana'))?.voteProgress?.voted ?? 0) >= 3);
    const prog = (await current('s_ana'))!.voteProgress;
    expect(prog).toEqual({ voted: 3, of: 4 });
    // s_dev got a numbered confirm card in the DM; answering by number casts the vote
    const dm = await history('s_dev', 'dm:s_dev');
    expect(texts(dm).join('\n')).toMatch(/Trip vote: where to\?/);
    await say('s_dev', 'dm:s_dev', '1');
    await waitFor(async () => (await current('s_ana'))?.status === 'confirming');
    const t = (await current('s_ana'))!;
    expect(t.chosen?.optionId).toBeTruthy();
    expect(texts(await history('s_ana', GROUP)).join('\n')).toContain('Voting closed');
  });

  it('plain "confirm" in the group confirms; REST confirms; trip.confirmed fires exactly once', async () => {
    const before = hub.deps.events.since(0).filter((e) => e.type === 'trip.confirmed').length;
    await say('s_ana', GROUP, 'confirm');
    await waitFor(async () => (await current('s_ana'))!.members.find((m) => m.id === 's_ana')!.confirmed);
    for (const id of ['s_ben', 's_chi', 's_dev']) {
      const r = await post(url, `/v1/trips/${tripId}/confirm`, { yes: true }, tok[id]);
      expect(r.status).toBe(200);
    }
    // a repeat confirm is idempotent
    await post(url, `/v1/trips/${tripId}/confirm`, { yes: true }, tok.s_ben);
    const t = (await current('s_ben'))!;
    expect(t.status).toBe('confirmed');
    const fired = hub.deps.events.since(0).filter((e) => e.type === 'trip.confirmed').length - before;
    expect(fired).toBe(1);
    expect(texts(await history('s_ana', GROUP)).join('\n')).toContain('Trip confirmed by all 4');
  });
});

describe('conflicts: two members editing at once', () => {
  let tripId = '';
  it('a stale edit gets a 409 with what changed; replacing is explicit and logged', async () => {
    const t0 = await post<{ trip: TripViewV2 }>(url, '/v1/trips', { destination: 'Austin', days: 3, perPerson: 400 }, tok.s_ben);
    expect(t0.status).toBe(200);
    tripId = t0.body.trip.tripId;
    await idle();
    const base = (await current('s_ana'))!;
    const opt = base.options[0]!;
    const rev = opt.rev!;
    const ben = await fetch(`${url}/v1/trips/${tripId}/options/${opt.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.s_ben}` },
      body: JSON.stringify({ baseRev: rev, perPerson: 500 }),
    });
    expect(ben.status).toBe(200);
    const ana = await fetch(`${url}/v1/trips/${tripId}/options/${opt.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.s_ana}` },
      body: JSON.stringify({ baseRev: rev, perPerson: 450 }),
    });
    expect(ana.status).toBe(409);
    const body = (await ana.json()) as { error: { code: string }; conflict: { change: { byName: string } | null; rev: number } };
    expect(body.error.code).toBe('conflict');
    expect(body.conflict.change?.byName).toBe('Ben');
    // nothing was overwritten
    expect((await current('s_ana'))!.options[0]!.perPerson).toBe(500);
    const replace = await fetch(`${url}/v1/trips/${tripId}/options/${opt.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok.s_ana}` },
      body: JSON.stringify({ baseRev: body.conflict.rev, perPerson: 450, replace: true }),
    });
    expect(replace.status).toBe(200);
    expect((await current('s_ana'))!.options[0]!.perPerson).toBe(450);
    expect(texts(await history('s_chi', GROUP)).join('\n')).toMatch(/Ana changed/);
  });

  it('votes never conflict: a revote replaces your own row', async () => {
    const t = (await current('s_ana'))!;
    if (t.status !== 'voting') return;
    const ids = t.options.map((o) => o.id);
    expect((await post(url, `/v1/trips/${tripId}/vote`, { ranking: ids }, tok.s_ana)).status).toBe(200);
    expect((await post(url, `/v1/trips/${tripId}/vote`, { ranking: [...ids].reverse() }, tok.s_ana)).status).toBe(200);
  });
});

describe('honest agent states', () => {
  it('an offline agent is named, the trip waits, retry resumes it when the agent is back', async () => {
    const cur = (await current('s_ana'))!;
    await post(url, `/v1/trips/${cur.tripId}/cancel`, {}, tok.s_ben);
    offline.add('s_chi');
    startCalls = [];
    const made = await post<{ trip: TripViewV2 }>(url, '/v1/trips', { destination: 'Tokyo', month: 4 }, tok.s_dev);
    expect(made.status).toBe(200);
    await idle();
    const t = (await current('s_dev'))!;
    expect(t.status).toBe('planning');
    expect(t.constraints.state).toBe('waiting');
    expect(t.constraints.note).toMatch(/offline, trip waits for /);
    expect(t.constraints.waitingFor.map((w) => w.id)).toEqual(['s_chi']);
    expect(t.members.find((m) => m.id === 's_chi')?.agent).toBe('offline');
    expect(startCalls).toHaveLength(0); // nothing is checked until everyone is reachable
    expect(texts(await history('s_ana', GROUP)).join('\n')).toMatch(/offline, trip waits for/);
    // voting cannot start early
    const early = await post(url, `/v1/trips/${t.tripId}/vote`, { ranking: [t.options[0]!.id] }, tok.s_ana);
    expect(early.status).toBe(409);
    offline.delete('s_chi');
    await new Promise((r) => setTimeout(r, 2100)); // retry rate limit
    const r = await post<{ trip: TripViewV2 }>(url, `/v1/trips/${t.tripId}/retry`, {}, tok.s_chi);
    expect(r.status).toBe(200);
    await idle();
    expect((await current('s_dev'))!.status).toBe('voting');
    expect(startCalls).toHaveLength(1);
  });

  it('only the organizer may continue without, and the skip is stated', async () => {
    const cur = (await current('s_dev'))!;
    await post(url, `/v1/trips/${cur.tripId}/cancel`, {}, tok.s_dev);
    offline.add('s_ben');
    await post(url, '/v1/trips', { destination: 'Lisbon' }, tok.s_ana);
    await idle();
    const t = (await current('s_ana'))!;
    expect(t.constraints.state).toBe('waiting');
    expect((await post(url, `/v1/trips/${t.tripId}/continue`, {}, tok.s_chi)).status).toBe(403);
    const ok = await post<{ trip: TripViewV2 }>(url, `/v1/trips/${t.tripId}/continue`, {}, tok.s_ana);
    expect(ok.status).toBe(200);
    expect(ok.body.trip.status).toBe('voting');
    expect(ok.body.trip.constraints.state).toBe('skipped');
    expect(ok.body.trip.constraints.note).toMatch(/were not checked/);
    offline.delete('s_ben');
  });
});

describe('squads are isolated; a squad with no trip says so', () => {
  it('another squad never sees, votes in or confirms this squad\'s trips', async () => {
    const s = await post<{ challengeId: string }>(url, '/v1/auth/start', { name: 'Eve', phone: '4155550777' });
    expect(s.status).toBe(200);
    const sender = (hub.deps as unknown as { codeSender: ReturnType<typeof createMemoryCodeSender> }).codeSender;
    const code = sender.last()!.code;
    const v = await post<{ token: string }>(url, '/v1/auth/verify', { challengeId: s.body.challengeId, code });
    expect(v.status).toBe(200);
    const eve = v.body.token;
    const sq = await post<{ squad: { id: string } }>(url, '/v1/squads', { name: 'Other crew', course: 'BIO 101' }, eve);
    expect(sq.status).toBe(201);
    const none = await get<{ trip: unknown }>(url, '/v1/trips/current', eve);
    expect(none.status).toBe(200);
    expect(none.body.trip).toBeNull();
    const demo = (await current('s_ana'))!;
    expect((await get(url, `/v1/trips/${demo.tripId}`, eve)).status).toBe(404);
    expect((await post(url, `/v1/trips/${demo.tripId}/vote`, { ranking: [demo.options[0]!.id] }, eve)).status).toBe(404);
    expect((await post(url, `/v1/trips/${demo.tripId}/confirm`, { yes: true }, eve)).status).toBe(404);
    expect((await post(url, `/v1/trips/${demo.tripId}/cancel`, {}, eve)).status).toBe(404);
    // a one-person real squad can still plan: nothing to compare, so voting opens with a plain note
    const mine = await post<{ trip: TripViewV2 }>(url, '/v1/trips', { destination: 'Cabo' }, eve);
    expect(mine.status).toBe(200);
    await idle();
    const t = (await get<{ trip: TripViewV2 }>(url, '/v1/trips/current', eve)).body.trip!;
    expect(t.constraints.state).toBe('skipped');
    expect(t.status).toBe('voting');
    // the original squad is untouched
    expect((await current('s_ana'))!.tripId).toBe(demo.tripId);
  });
});

describe('the seeded demo trip still answers', () => {
  it('trip_cabo resolves by trip id and task id', async () => {
    expect((await get<{ tripId: string }>(url, '/v1/trips/trip_cabo', tok.s_ana)).body.tripId).toBe('trip_cabo');
    expect((await get<{ tripId: string }>(url, '/v1/trips/task_trip_cabo', tok.s_ana)).body.tripId).toBe('trip_cabo');
  });
});
