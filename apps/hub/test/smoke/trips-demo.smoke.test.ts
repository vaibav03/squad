import { cpSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TripViewV2 } from '@squad/core';
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
  return new Promise((r) =>
    srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)),
  );
}

const MEMBERS_ALL = MEMBERS;
async function run(demo: boolean) {
  const replayDir = mkdtempSync(join(tmpdir(), 'trip-demo-'));
  cpSync(FIXTURE, join(replayDir, 'sample.json'));
  const h = await startHub({
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
      ...(demo ? { demoCode: '123456' } : {}),
    },
    codeSender: createMemoryCodeSender(),
  });
  const urls: Record<string, string> = {};
  const t: Record<string, string> = {};
  for (const id of MEMBERS_ALL) {
    urls[id] = await fakeAgent(id);
    t[id] = await login(h.url, id);
  }
  h.deps.tripSvc.setAgentUrls(urls);
  return { h, t };
}

describe.each([true, false])('trip organizer vote, demo=%s', (demo) => {
  it(demo ? 'auto-accepts everyone, confirms once, idempotent' : 'old flow unchanged', async () => {
    outcome = defaultOutcome;
    const { h, t } = await run(demo);
    const cur = async (as: string) =>
      (await get<{ trip: TripViewV2 | null }>(h.url, '/v1/trips/current', t[as])).body.trip;
    const created = await post(
      h.url,
      '/v1/trips',
      { destination: 'Truck Demo', perPerson: 500 },
      t.s_ana,
    );
    expect(created.status).toBeLessThan(300);
    await h.deps.tripSvc.idle();
    const trip = (await cur('s_ana'))!;
    const rank = [trip.options[0]!.id];
    const msgs = () =>
      h.deps.chat.store
        .history(GROUP, { limit: 100 })
        .messages.filter((m) => m.card?.type === 'trip' && /confirmed by all/.test(m.text));
    const r1 = await post<{ trip: TripViewV2 }>(
      h.url,
      `/v1/trips/${trip.tripId}/vote`,
      { ranking: rank },
      t.s_ana,
    );
    const after = (await cur('s_ben'))!;
    if (demo) {
      expect(r1.status).toBe(200);
      expect(after.status).toBe('confirmed');
      expect(after.demoAuto).toBe(true);
      expect(after.confirmations.length).toBeGreaterThanOrEqual(4);
      expect(after.confirmations.every((c) => c.confirmed)).toBe(true);
      expect(msgs()).toHaveLength(1);
      expect(msgs()[0]!.text).toContain('Demo: all members auto-accepted');
      const rec = h.deps.trips.get(trip.tripId)!;
      expect(rec.collab!.confirmedAt).toBeTypeOf('number');
      expect(rec.votes.length).toBe(rec.confirmations.length);
      const c2 = await post(h.url, `/v1/trips/${trip.tripId}/confirm`, { yes: true }, t.s_ana);
      expect(c2.status).toBe(200);
      const v2 = await post(h.url, `/v1/trips/${trip.tripId}/vote`, { ranking: rank }, t.s_ana);
      expect(v2.status).toBe(200);
      expect(msgs()).toHaveLength(1);
    } else {
      expect(after.status).toBe('voting');
      expect(after.demoAuto).toBeUndefined();
      expect(after.confirmations.filter((c) => c.confirmed)).toHaveLength(0);
      expect(msgs()).toHaveLength(0);
      expect(h.deps.trips.get(trip.tripId)!.collab!.confirmedAt).toBeUndefined();
    }
    await h.stop();
  });
});

afterAll(() => {
  for (const s of servers) s.close();
});
