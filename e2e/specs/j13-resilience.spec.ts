import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, TMP } from '../lib/env';
import { blocked, expect, note, sseEvents, test } from '../lib/helpers';

const PORT = Number(process.env.E2E_J13_PORT ?? 8893);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(TMP, 'j13.db');

function dotenvKey(name: string): string | undefined {
  try {
    const m = new RegExp(`^${name}=["']?([^"'\\s#]+)`, 'm').exec(
      fs.readFileSync(path.join(REPO, '.env'), 'utf8'),
    );
    return m?.[1];
  } catch {
    return undefined;
  }
}
function hubEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const gemini = process.env.GEMINI_API_KEY ?? dotenvKey('GEMINI_API_KEY');
  return {
    ...(gemini ? { GEMINI_API_KEY: gemini } : {}),
    ...process.env,
    HUB_PORT: String(PORT),
    HUB_BASE_URL: BASE,
    DB_PATH: DB,
    INTERNAL_EVENTS_SECRET: 'dev-internal-secret',
    HUB_CORS_ORIGINS: 'http://localhost:5271',
    AGENT_PEERS: 's_ana=http://localhost:59991,s_ben=http://localhost:59992', // closed ports: agents offline
    ...extra,
  };
}
let proc: ChildProcess | null = null;
async function up(extra: Record<string, string> = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  const log = fs.openSync(path.join(TMP, 'j13-hub.log'), 'a');
  proc = spawn('pnpm', ['--filter', '@squad/hub', 'start'], {
    cwd: REPO,
    env: hubEnv(extra),
    stdio: ['ignore', log, log],
    detached: true,
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* wait */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('j13 hub did not start');
}
function kill9() {
  // only the process group this spec spawned (the hub's own children included)
  if (proc?.pid) {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }
  proc = null;
}
const login = async (id: string) =>
  (
    (await (
      await fetch(`${BASE}/v1/auth/dev-login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studentId: id }),
      })
    ).json()) as { token: string }
  ).token;

async function sse(token: string, ms: number, lastId?: string) {
  const st = (
    (await (
      await fetch(`${BASE}/v1/squad/stream-token`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { st: string }
  ).st;
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), ms);
  let buf = '';
  try {
    const r = await fetch(`${BASE}/v1/squad/stream?st=${encodeURIComponent(st)}`, {
      signal: ctl.signal,
      headers: lastId ? { 'Last-Event-ID': lastId } : {},
    });
    const rd = r.body!.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value);
    }
  } catch {
    /* aborted */
  }
  return sseEvents(buf).filter((e) => e.id);
}

test.afterAll(() => kill9());

test('J13 hub killed mid-session: state persists and the stream resumes with Last-Event-ID, no duplicates', async () => {
  test.setTimeout(180_000);
  const stale = await fetch(`${BASE}/health`).then(
    (r) => r.ok,
    () => false,
  );
  expect(
    stale,
    `port ${PORT} already answers: a hub from an earlier run is still alive (stop it yourself, or set E2E_J13_PORT)`,
  ).toBe(false);
  fs.rmSync(DB, { force: true });
  await up({ FORCE_FAKE_LLM: '1' });
  const tok = await login('s_ana');
  await fetch(`${BASE}/__sim/squad/demo-run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speed: 50 }),
  });
  await new Promise((r) => setTimeout(r, 6000));
  const before = await sse(tok, 2500, '0'); // replay from the start of the log
  expect(before.length).toBeGreaterThan(3);
  const lastId = before[Math.floor(before.length / 2)]!.id!;
  const stateBefore = (await (
    await fetch(`${BASE}/v1/squad/state`, { headers: { authorization: `Bearer ${tok}` } })
  ).json()) as { seq: number };
  kill9(); // SIGKILL mid-session
  await new Promise((r) => setTimeout(r, 1000));
  await up({ FORCE_FAKE_LLM: '1' });
  const tok2 = await login('s_ana'); // tokens are stateless HMAC: the old one also works
  const oldTokenRes = await fetch(`${BASE}/v1/squad/state`, {
    headers: { authorization: `Bearer ${tok}` },
  });
  note(`pre-restart token after restart -> ${oldTokenRes.status}`);
  expect
    .soft(
      oldTokenRes.status,
      'E2E-010: a bearer token issued before a hub restart is rejected (401) after it; students would be signed out by every restart',
    )
    .toBe(200);
  const freshRes = await fetch(`${BASE}/v1/squad/state`, {
    headers: { authorization: `Bearer ${tok2}` },
  });
  expect(freshRes.status).toBe(200);
  const stateAfter = (await freshRes.json()) as { seq: number };
  note(`seq before ${stateBefore.seq} after restart ${stateAfter.seq}`);
  expect(stateAfter.seq, 'event log must persist across a hub restart').toBeGreaterThanOrEqual(
    stateBefore.seq,
  );
  const resumed = await sse(tok2, 2500, lastId);
  const ids = resumed.map((e) => Number(e.id));
  expect(ids.length).toBeGreaterThan(0);
  expect(
    ids.every((n) => n > Number(lastId)),
    'resume must only replay events after Last-Event-ID',
  ).toBe(true);
  expect(new Set(ids).size, 'no duplicate events on resume').toBe(ids.length);
  const fresh = resumed.map((e) => e.id);
  expect(fresh).toEqual([...fresh].sort((a, b) => Number(a) - Number(b)));
});

test('J13 agent offline: hub stays healthy when the owner agent cannot be reached', async () => {
  if (!proc) await up({ FORCE_FAKE_LLM: '1' });
  const tok = await login('s_ana');
  const fd = new FormData();
  const ics = fs.readFileSync(path.join(REPO, 'apps/agent/fixtures/ics/s_ana.ics'));
  fd.append('file', new Blob([ics], { type: 'text/calendar' }), 'ana.ics');
  const r = await fetch(`${BASE}/v1/squad/calendar`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}` },
    body: fd,
  });
  note(`calendar upload with agent offline -> ${r.status}`);
  expect(r.status).toBeLessThan(500);
  expect((await fetch(`${BASE}/health`)).status).toBe(200);
  const state = (await (
    await fetch(`${BASE}/v1/squad/state`, { headers: { authorization: `Bearer ${tok}` } })
  ).json()) as { agents: Record<string, string> };
  expect(state.agents).toBeTruthy();
});

test('J13 credits depleted (HTTP 402): banner status, then recovery path', async () => {
  // Needs the real Gemini key. Without injection support (the Gemini endpoint is not configurable) this can only
  // be observed against the real API, which currently answers 402.
  kill9();
  const hasKey = !!(process.env.GEMINI_API_KEY ?? dotenvKey('GEMINI_API_KEY'));
  if (!hasKey)
    blocked(
      'no GEMINI_API_KEY available to provoke a real 402; the Gemini endpoint cannot be stubbed (no base-URL env)',
    );
  await up({ FORCE_FAKE_LLM: '' });
  const s0 = (await (await fetch(`${BASE}/v1/status`)).json()) as {
    llm: string;
    reason?: string;
    notice?: string;
  };
  note(`status at boot: ${s0.llm} ${s0.reason ?? ''}`);
  // trigger a model call through the public quiz route if it exists; otherwise only the boot state can be asserted
  const tok = await login('s_ana');
  await fetch(`${BASE}/v1/squad/courses`, { headers: { authorization: `Bearer ${tok}` } });
  await new Promise((r) => setTimeout(r, 8000));
  const s1 = (await (await fetch(`${BASE}/v1/status`)).json()) as {
    llm: string;
    reason?: string;
    notice?: string;
    demo: boolean;
  };
  note(`status after traffic: ${s1.llm} ${s1.reason ?? ''}`);
  if (s1.llm === 'gemini')
    blocked(
      'no model call happens without the chat feature (not merged yet); status stays gemini until the first call',
    );
  expect(s1.demo).toBe(true);
  expect(['credits_depleted', 'invalid_key', 'rate_limited']).toContain(s1.reason);
  expect(s1.notice).toMatch(/Demo mode/);
});
