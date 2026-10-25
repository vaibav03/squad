// The gate's hub entrypoint (FIXTURE ONLY). Same wiring as apps/hub/src/main.ts, except the iMessage bridge sits on
// a scripted ScenarioTransport that a loopback-only control server drives. It refuses to start with GATE_REAL=1:
// real runs use the real apps/hub/src/main.ts with the real SDK (see e2e/gate/real/smoke.ts).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startHub } from '../../../apps/hub/src/server';
import { attachChatEngine } from '../../../apps/hub/src/chat/engine';
import { getObs, instrumentLlm } from '../../../apps/hub/src/observability';
import { agentUrlsFromEnv } from '../../../apps/hub/src/wire';
import { attachIMessage } from '../../../apps/hub/src/imessage/wire';
import { ScenarioTransport } from './fakes/imessage-scenario';

if (process.env.GATE_REAL === '1') {
  console.error('gate-hub is fixture-only; refusing to start with GATE_REAL=1');
  process.exit(2);
}
const CTL_PORT = Number(process.env.GATE_CTL_PORT ?? 8942);

// Test seam: outgoing calls to the Google hosts and to the fixture Canvas origin go to the gate's fake servers (HTTP,
// loopback), so the REAL connectors run unmodified. Nothing else is touched; this process refuses GATE_REAL runs.
const GOOGLE_FAKE = `http://localhost:${process.env.GATE_GOOGLE_PORT ?? 8941}`;
const CANVAS_FAKE = `http://localhost:${process.env.GATE_CANVAS_PORT ?? 8940}`;
const GOOGLE_HOSTS = new Set([
  'accounts.google.com',
  'oauth2.googleapis.com',
  'openidconnect.googleapis.com',
  'www.googleapis.com',
  'classroom.googleapis.com',
]);
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let u: URL | undefined;
  try {
    u = new URL(raw);
  } catch {
    /* relative or malformed: leave it alone */
  }
  if (u && GOOGLE_HOSTS.has(u.host))
    return realFetch(`${GOOGLE_FAKE}/__h/${u.host}${u.pathname}${u.search}`, init);
  if (u && u.host === 'canvas.fixture.invalid')
    return realFetch(`${CANVAS_FAKE}${u.pathname}${u.search}`, init);
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;
const TMP = process.env.GATE_TMP ?? path.resolve(process.cwd(), 'e2e/gate/.tmp');
const DRY = process.env.GATE_IM_DRY_RUN === '1';

// Chat and handle pools: the gateway allowlists are fixed at start, worlds draw from the pools.
const WORLDS = 24; // fresh worlds per stack: the journey plus the variants
const CHATS = Array.from({ length: WORLDS * 2 }, (_, i) => `iMessage;+;gate-c${i + 1}`);
const SPARE_CHAT = 'iMessage;+;gate-spare'; // allowlisted but never bound to a squad
const phone = (w: number, u: number) =>
  `+155570${String(w).padStart(2, '0')}${String(u).padStart(2, '0')}`;
const HANDLES = Array.from({ length: WORLDS }, (_, w) =>
  Array.from({ length: 8 }, (_, u) => phone(w, u)),
).flat();

const hub = await startHub();
const obs = getObs(hub.deps)!;
obs.installProcessHandlers();
const agentUrls = agentUrlsFromEnv();
hub.deps.confirms.setAgentUrls(agentUrls);
// trip-collab adds a trip service that needs the agent urls; absent on trees where it has not landed
(hub.deps as unknown as { tripSvc?: { setAgentUrls(u: unknown): void } }).tripSvc?.setAgentUrls(
  agentUrls,
);
const chat = await attachChatEngine(hub, {
  realPorts: true,
  agentUrls,
  instrument: (llm) => instrumentLlm(llm, obs.metrics),
});
const sdk = new ScenarioTransport(path.join(TMP, 'chatdb-gap.json'));
// A virtual clock for the iMessage bridge only: the outbound retry ladder is 2 s, 8 s, 30 s, 2 min, 5 min; the
// scenario skips it with /ctl/clock/advance instead of sleeping for minutes.
let skew = 0;
const vnow = () => Date.now() + skew;
const im = await attachIMessage(hub, {
  sdk,
  now: vnow,
  config: {
    enabled: true,
    dryRun: DRY,
    allowedChats: [...CHATS, SPARE_CHAT],
    allowedHandles: HANDLES,
    allowAll: false,
    ratePerMin: 1000,
    ignoreHandles: [],
  },
  minGapMs: 0,
  sleep: async () => {},
});
if (!im) throw new Error('gate-hub: iMessage bridge did not start');

let ipN = 1;
const call = async (method: string, p: string, token?: string, body?: unknown) => {
  ipN++;
  const r = await hub.app.request(p, {
    method,
    headers: {
      'content-type': 'application/json',
      // each simulated person comes from their own address, so the hub's per-IP sign-up limit never trips
      'x-forwarded-for': `10.${(ipN >> 16) & 255}.${(ipN >> 8) & 255}.${ipN & 255}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try {
    json = await r.json();
  } catch {
    /* empty body */
  }
  return { status: r.status, body: json };
};

const JOURNEY_FILE = path.join(TMP, 'world-journey.json');
const IDX_FILE = path.join(TMP, 'world-idx');
let journey: Record<string, any> | undefined;
// (wired below once wireAgents exists)
try {
  journey = JSON.parse(fs.readFileSync(JOURNEY_FILE, 'utf8'));
} catch {
  /* first start */
}
// persisted so a hub restart never hands out phones and chats that an earlier world already owns
let worldIdx = (() => {
  try {
    return Number(fs.readFileSync(IDX_FILE, 'utf8')) || 0;
  } catch {
    return 0;
  }
})();
async function signUp(name: string, ph: string) {
  const s = await call('POST', '/v1/auth/start', undefined, { name, phone: ph });
  const v = await call('POST', '/v1/auth/verify', undefined, {
    challengeId: s.body.challengeId,
    code: s.body.devCode,
  });
  if (!v.body?.token) throw new Error(`sign-up failed for ${name}: ${v.status}`);
  return { id: v.body.user.id as string, token: v.body.token as string, phone: ph, name };
}

type U = { id: string; token: string; phone: string; name: string };
const AGENT_BASE = Number(process.env.GATE_AGENT_BASE ?? 4771);

/** Points the trip service and the confirm flow at the agent of each journey member (slot order rhea, ben, cy, dan). */
function wireAgents(users: Record<string, U>) {
  const urls: Record<string, string> = {};
  ['rhea', 'ben', 'cy', 'dan'].forEach((k, i) => {
    if (users[k]) urls[users[k]!.id] = `http://localhost:${AGENT_BASE + i}`;
  });
  hub.deps.confirms.setAgentUrls(urls);
  (hub.deps as unknown as { tripSvc?: { setAgentUrls(u: unknown): void } }).tripSvc?.setAgentUrls(
    urls,
  );
  return urls;
}
if (journey) wireAgents(journey.users as Record<string, U>);

/**
 * Fresh world: Rhea, Ben, Cy in squad A (group chat A); with `b`, squad B with Dan and Cy (group chat B).
 * Journey world (kind 'journey', a singleton that survives a hub restart): Rhea, Ben, Cy and Dan all in squad A, and
 * the hub wired to their four live agents, whose private profiles the stack generates for exactly these ids.
 */
async function makeWorld(opts: { b?: boolean; kind?: 'fresh' | 'journey' } = {}) {
  if (opts.kind === 'journey' && journey) {
    // after a hub restart the accounts and the squad persist; only the tokens are re-issued
    const u: Record<string, U> = {};
    for (const [k, v] of Object.entries(journey.users as Record<string, U>))
      u[k] = await signUp(v.name, v.phone);
    journey = { ...journey, users: u };
    wireAgents(u);
    return journey;
  }
  const w = worldIdx++;
  fs.writeFileSync(IDX_FILE, String(worldIdx));
  if (w >= WORLDS)
    throw new Error(`world pool exhausted (max ${WORLDS} worlds; restart the gate stack)`);
  const rhea = await signUp('Rhea', phone(w, 0));
  const ben = await signUp('Ben', phone(w, 1));
  const cy = await signUp('Cy', phone(w, 2));
  const a = await call('POST', '/v1/squads', rhea.token, { name: `Stats Crew ${w}` });
  const squadA = a.body.squad.id as string;
  const invA = await call('POST', `/v1/squads/${squadA}/invites`, rhea.token, { maxUses: null });
  const codeA = invA.body.invite.code as string;
  await call('POST', '/v1/invites/join', ben.token, { code: codeA });
  await call('POST', '/v1/invites/join', cy.token, { code: codeA });
  const out: Record<string, any> = {
    index: w,
    users: { rhea, ben, cy },
    squadA: { id: squadA, invite: codeA, chat: CHATS[2 * w]!, chatId: `group:${squadA}` },
  };
  if (opts.kind === 'journey') {
    const dan = await signUp('Dan', phone(w, 3));
    await call('POST', '/v1/invites/join', dan.token, { code: codeA });
    out.users = { rhea, ben, cy, dan };
    wireAgents(out.users);
    journey = out;
    fs.writeFileSync(JOURNEY_FILE, JSON.stringify(out));
  } else if (opts.b) {
    const dan = await signUp('Dan', phone(w, 3));
    const b = await call('POST', '/v1/squads', dan.token, { name: `Bio Crew ${w}` });
    const squadB = b.body.squad.id as string;
    const invB = await call('POST', `/v1/squads/${squadB}/invites`, dan.token, { maxUses: null });
    const codeB = invB.body.invite.code as string;
    // Cy belongs to B on the web but is deliberately NOT opted into context sharing for B.
    await call('POST', '/v1/invites/join', cy.token, { code: codeB });
    out.users = { rhea, ben, cy, dan };
    out.squadB = { id: squadB, invite: codeB, chat: CHATS[2 * w + 1]!, chatId: `group:${squadB}` };
  }
  return out;
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readJson = (req: http.IncomingMessage): Promise<any> =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });

const ctl = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    const b = req.method === 'POST' ? await readJson(req) : {};
    if (p === '/ctl/health') return json(res, 200, { ok: true, dry: DRY });
    if (p === '/ctl/world') return json(res, 200, await makeWorld(b));
    if (p === '/ctl/trip/agents') {
      // explicit user id -> agent url map (the journey world is wired automatically; this is for custom worlds)
      const m = (b.map ?? {}) as Record<string, string>;
      hub.deps.confirms.setAgentUrls(m);
      (
        hub.deps as unknown as { tripSvc?: { setAgentUrls(u: unknown): void } }
      ).tripSvc?.setAgentUrls(m);
      return json(res, 200, { ok: true, count: Object.keys(m).length });
    }
    if (p === '/ctl/im/say') {
      await sdk.say(b.chat, b.from, b.text, b.guid ? { id: b.guid } : {});
      await im.bridge.flush();
      return json(res, 200, { ok: true, last: sdk.lastGuid() });
    }
    if (p === '/ctl/im/dm') {
      await sdk.dm(b.from, b.text);
      await im.bridge.flush();
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/im/duplicate') {
      await sdk.duplicate(b.guid, b.times ?? 1);
      await im.bridge.flush();
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/im/out-of-order') {
      const r = await sdk.outOfOrder(b.messages);
      await im.bridge.flush();
      return json(res, 200, { guids: r });
    }
    if (p === '/ctl/im/drop') {
      sdk.dropWatcher();
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/im/backfill') {
      // the watcher is back: the hub asks chat.db for what its bound chats missed (the real backfill path)
      const gap = sdk.gapSize();
      sdk.restoreWatcher();
      const r = await im.reconnect();
      await im.bridge.flush();
      sdk.clearGap();
      return json(res, 200, { delivered: r.messages, chats: r.chats, gap });
    }
    if (p === '/ctl/im/fail-next') {
      sdk.failNext(b.n ?? 1);
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/im/delay') {
      sdk.delay(b.ms ?? 0);
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/im/reset') {
      sdk.reset();
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/im/sent') {
      const to = url.searchParams.get('to');
      return json(res, 200, {
        sent: sdk.sent.filter((s) => !to || s.to === to),
        receipts: sdk.receipts.filter((s) => !to || s.to === to),
        gap: sdk.gapSize(),
        dryRunOutbox: DRY,
      });
    }
    if (p === '/ctl/im/log')
      return json(res, 200, {
        log: sdk.history.map((m) => ({
          id: m.id,
          chatId: m.chatId,
          sender: m.participant,
          text: m.text,
        })),
      });
    if (p === '/ctl/clock/advance') {
      skew += Number(b.ms ?? 0);
      return json(res, 200, { skewMs: skew });
    }
    if (p === '/ctl/im/receipt') {
      sdk.receipt(b.guid, b.state ?? 'delivered', b.reason);
      return json(res, 200, { ok: true });
    }
    if (p === '/ctl/db/dump') {
      // Hub DB vantage point for the sweep. Read-only; the harness scans it and never prints it.
      const tables = hub.deps.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const out: Record<string, unknown[]> = {};
      for (const t of tables) out[t.name] = hub.deps.db.prepare(`SELECT * FROM "${t.name}"`).all();
      return json(res, 200, out);
    }
    json(res, 404, { error: 'not_found' });
  } catch (e) {
    json(res, 500, { error: String((e as Error).message) });
  }
});
ctl.listen(CTL_PORT, '127.0.0.1');

hub.deps.log.info(`gate-hub: ready (ctl ${CTL_PORT}, imDryRun=${DRY})`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    ctl.close();
    void Promise.resolve(im.stop())
      .then(() => chat.stop())
      .then(() => hub.stop())
      .then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
