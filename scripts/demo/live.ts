/**
 * pnpm demo:live: the whole stack in one process, no real keys.
 * Boots the hub (sqlite in memory, real brain/quiz ports on FakeLlm), four mesh agents (apps/agent, ports 4101-4104),
 * and the bot's fake-chat transport that carries every DM confirm. Runs the study flow (brain study plan scheduled by the
 * mesh) and the trip flow, then asserts over the hub's own stream: trip.confirmed exactly once and only after every
 * confirm, the sentinels never reach any viewer, every event validates. Squad id sq_demo. Exits 1 on any failure.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudentsConfirm } from './lib/live-bot';
import {
  FakeLlm,
  SENTINELS,
  VillageEventSchema,
  findLeak,
  postEvent,
  type VillageEvent,
} from '@squad/core';
import { createHttpCoordinator, createMeshScheduler } from '@squad/mesh';
import { createHubEmitter, createHubPort, parseProfile, startMesh } from '@squad/agent';
import { createMasteryStore, runStudyPlan } from '@squad/brain';
import { startHub } from '@squad/hub';
import { wireRealPorts } from '@squad/hub/real';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fx = (f: string) => join(root, 'apps/agent/fixtures', f);
const STUDENTS = ['s_ana', 's_ben', 's_cam', 's_dev'] as const;
const SQUAD = 'sq_demo';
const SECRET = 'demo-live-secret';
const failures: string[] = [];
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};

interface Frame {
  event: string;
  data: string;
}
/** Minimal SSE client for one viewer. */
async function openStream(url: string, token: string) {
  const st = (
    (await (
      await fetch(`${url}/v1/squad/stream-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{}',
      })
    ).json()) as { st: string }
  ).st;
  const ac = new AbortController();
  const res = await fetch(`${url}/v1/squad/stream?st=${encodeURIComponent(st)}`, {
    signal: ac.signal,
  });
  const frames: Frame[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const f = { event: '', data: '' };
          for (const line of raw.split('\n')) {
            if (line.startsWith('event: ')) f.event = line.slice(7);
            else if (line.startsWith('data: ')) f.data = line.slice(6);
          }
          if (f.event) frames.push(f);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, stop: () => ac.abort() };
}

async function main(): Promise<void> {
  process.env.HUB_BASE_URL = 'http://localhost:0'; // replaced below once the port is known
  process.env.INTERNAL_EVENTS_SECRET = SECRET;

  // ---- hub
  const hub = await startHub({
    config: {
      port: 0,
      baseUrl: 'http://localhost:0',
      internalSecret: SECRET,
      authSecret: `auth-${SECRET}`,
      dbPath: ':memory:',
      seed: false,
      sim: false,
      logLevel: 'silent',
      production: false,
    },
  });
  process.env.HUB_BASE_URL = hub.url;
  for (const id of STUDENTS)
    hub.deps.directory.upsertStudent({
      id,
      name: id.slice(2),
      handle: `${id.slice(2)}@demo.test`,
    });
  hub.deps.directory.upsertSquad({ id: SQUAD, name: 'Demo squad', members: [...STUDENTS] });
  const llm = new FakeLlm({ fallback: 'ok' });
  const real = await wireRealPorts(hub, { llm });
  check(
    real.brain.store.listChapters('demo').length > 0,
    'hub: real brain port loaded course "demo" (fixture)',
  );

  // ---- viewers
  const tokens: Record<string, string> = {};
  for (const id of STUDENTS) {
    const r = await fetch(`${hub.url}/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: id }),
    });
    tokens[id] = ((await r.json()) as { token: string }).token;
  }
  const streams = await Promise.all(STUDENTS.map((id) => openStream(hub.url, tokens[id]!)));

  // ---- bot fake-chat transport carrying every confirm DM
  const emitter = createHubEmitter();
  const students = createStudentsConfirm([...STUDENTS], (e: VillageEvent) => {
    void postEvent(e).catch(() => undefined);
  });

  // ---- mesh agents
  const profiles = STUDENTS.map((id) =>
    parseProfile(JSON.parse(readFileSync(fx(`${id}.json`), 'utf8'))),
  );
  const mesh = await startMesh({
    profiles,
    emitter,
    hub: createHubPort(), // x.trip.upsert / x.trip.limits / x.ledger.private to the hub (HUB_BASE_URL + secret from env)
    basePort: 4101,
    secret: SECRET,
    llm: new FakeLlm({ fallback: 'ok' }),
    askConfirm: (s) => students.askConfirm(s),
    seed: 'demo-live',
  });
  try {
    // ---- study flow: brain's study plan, scheduled by the mesh (not brain's stub)
    let meshCalls = 0;
    const http = createHttpCoordinator({ url: mesh.urls.s_ana!, secret: SECRET });
    const scheduler = createMeshScheduler({
      squadId: SQUAD,
      coordinator: {
        async startStudy(a) {
          meshCalls++;
          return http.startStudy(a);
        },
      },
    });
    const mastery = createMasteryStore({
      db: hub.deps.db,
      emit: (e) => void hub.deps.ingest.village(e),
    });
    await mastery.record('s_ana', 'demo', 'ch6', true);
    console.log('study: running plan');
    const plan = await runStudyPlan(
      {
        mastery,
        scheduler,
        askConfirm: (s, q, o, t) => students.askConfirm(s)(s, q, o, t),
        emit: async (e) => void hub.deps.ingest.village(e),
      },
      {
        courseId: 'demo',
        chapters: ['ch6', 'ch12'],
        students: [...STUDENTS],
        taskId: 'task_study_demo',
      },
    );
    check(meshCalls === 1, 'study: findSlots went through the mesh study flow');
    check(plan.slots.length > 0, `study: mesh returned a slot (${plan.slots.length})`);
    check(plan.confirmed.length === STUDENTS.length, 'study: every student confirmed by DM');

    // ---- trip flow
    console.log('trip: starting');
    const trips = JSON.parse(readFileSync(fx('trips.json'), 'utf8')) as object;
    const res = await fetch(`${mesh.urls.s_ana}/internal/start/trip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Nook-Internal': SECRET },
      body: JSON.stringify({
        taskId: 'task_trip_demo',
        members: [...STUDENTS],
        ...trips,
        squadId: SQUAD,
      }),
    });
    const outcome = (await res.json()) as { flow?: string; status?: string };
    check(
      outcome.flow === 'trip' && outcome.status === 'confirmed',
      `trip: outcome ${JSON.stringify(outcome)}`,
    );
    await new Promise((r) => setTimeout(r, 500)); // let the last events fan out

    // ---- the hub's own trip record: every agent posted its own limits (x.trip.limits), the coordinator via x.trip.upsert
    const rec = hub.deps.trips.get('task_trip_demo');
    check(rec !== undefined, 'hub: trip record exists (x.trip.upsert reached the hub)');
    check(
      STUDENTS.every((s) => Object.keys(rec?.limits[s] ?? {}).length > 0),
      `hub: trip limits merged for every student (${Object.keys(rec?.limits ?? {}).join(',')})`,
    );
    check(
      rec?.status === 'confirmed',
      `hub: trip record status confirmed (saw ${rec?.status ?? 'none'})`,
    );

    // ---- assertions over each viewer's stream
    for (const [i, id] of STUDENTS.entries()) {
      const frames = streams[i]!.frames;
      const village = frames.filter((f) => !f.event.startsWith('x.'));
      let invalid = 0;
      for (const f of village)
        if (!VillageEventSchema.safeParse(JSON.parse(f.data)).success) invalid++;
      check(invalid === 0, `${id}: ${village.length} village events all validate`);
      const leak = findLeak(
        frames.map((f) => f.data),
        SENTINELS,
      );
      check(leak === undefined, `${id}: sentinels ${SENTINELS.join(', ')} never appear`);
      const idx = village
        .map((f, n) => (f.event === 'trip.confirmed' ? n : -1))
        .filter((n) => n >= 0);
      check(idx.length === 1, `${id}: trip.confirmed exactly once (saw ${idx.length})`);
      const done = village.filter(
        (f) => f.event === 'confirm.done' && JSON.parse(f.data).taskId === 'task_trip_demo',
      );
      const lastDone = village.map((f, n) => ({ f, n })).filter(({ f }) => done.includes(f));
      check(
        idx.length === 1 && lastDone.length > 0 && lastDone.every(({ n }) => n < idx[0]!),
        `${id}: trip.confirmed arrives after every trip confirm.done (${done.length})`,
      );
    }
    check(
      students.dms().some((m) => /confirm|join|trip/i.test(m)),
      'bot: DM confirms went through the fake chat transport',
    );
  } finally {
    streams.forEach((s) => s.stop());
    await mesh.close();
    await hub.stop();
  }
}

setTimeout(() => {
  console.error('demo:live timed out after 90s');
  process.exit(1);
}, 90_000).unref();

main()
  .then(() => {
    console.log(failures.length ? `\ndemo:live FAILED (${failures.length})` : '\ndemo:live OK');
    process.exit(failures.length ? 1 : 0);
  })
  .catch((e) => {
    console.error('demo:live crashed:', (e as Error).message);
    process.exit(1);
  });
