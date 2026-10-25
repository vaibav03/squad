// The gate's hub entrypoint (FIXTURE ONLY). Same wiring as apps/hub/src/main.ts, except the iMessage bridge sits on
// a scripted ScenarioTransport that a loopback-only control server drives. It refuses to start with GATE_REAL=1:
// real runs use the real apps/hub/src/main.ts with the real SDK (see e2e/gate/real/smoke.ts).
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
const TMP = process.env.GATE_TMP ?? path.resolve(process.cwd(), 'e2e/gate/.tmp');
const DRY = process.env.GATE_IM_DRY_RUN === '1';

// Chat and handle pools: the gateway allowlists are fixed at start, worlds draw from the pools.
const CHATS = Array.from({ length: 12 }, (_, i) => `iMessage;+;gate-c${i + 1}`);
const SPARE_CHAT = 'iMessage;+;gate-spare'; // allowlisted but never bound to a squad
const phone = (w: number, u: number) => `+155570${String(w).padStart(2, '0')}${String(u).padStart(2, '0')}`;
const HANDLES = Array.from({ length: 12 }, (_, w) => Array.from({ length: 8 }, (_, u) => phone(w, u))).flat();

const hub = await startHub();
const obs = getObs(hub.deps)!;
obs.installProcessHandlers();
const agentUrls = agentUrlsFromEnv();
hub.deps.confirms.setAgentUrls(agentUrls);
const chat = await attachChatEngine(hub, {
  realPorts: true,
  agentUrls,
  instrument: (llm) => instrumentLlm(llm, obs.metrics),
});
const sdk = new ScenarioTransport(path.join(TMP, 'chatdb-gap.json'));
const im = await attachIMessage(hub, {
  sdk,
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

const call = async (method: string, p: string, token?: string, body?: unknown) => {
  const r = await hub.app.request(p, {
    method,
    headers: {
      'content-type': 'application/json',
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

let worldIdx = 0;
async function signUp(name: string, ph: string) {
  const s = await call('POST', '/v1/auth/start', undefined, { name, phone: ph });
  const v = await call('POST', '/v1/auth/verify', undefined, {
    challengeId: s.body.challengeId,
    code: s.body.devCode,
  });
  if (!v.body?.token) throw new Error(`sign-up failed for ${name}: ${v.status}`);
  return { id: v.body.user.id as string, token: v.body.token as string, phone: ph, name };
}

/** One fixture world: Rhea, Ben, Cy in squad A (group chat A), plus squad B with Cy and Dan (group chat B). */
async function makeWorld(opts: { b?: boolean } = {}) {
  const w = worldIdx++;
  if (w >= 6) throw new Error('world pool exhausted (max 6 worlds; restart the gate stack)');
  const rhea = await signUp('Rhea', phone(w, 0));
  const ben = await signUp('Ben', phone(w, 1));
  const cy = await signUp('Cy', phone(w, 2));
  const a = await call('POST', '/v1/squads', rhea.token, { name: `Stats Crew ${w}` });
  const squadA = a.body.squad.id as string;
  const invA = await call('POST', `/v1/squads/${squadA}/invites`, rhea.token, { maxUses: null });
  const codeA = invA.body.invite.code as string;
  await call('POST', '/v1/invites/join', ben.token, { code: codeA });
  await call('POST', '/v1/invites/join', cy.token, { code: codeA });
  const out: Record<string, unknown> = {
    index: w,
    users: { rhea, ben, cy },
    squadA: { id: squadA, invite: codeA, chat: CHATS[w]! , chatId: `group:${squadA}` },
  };
  if (opts.b) {
    const dan = await signUp('Dan', phone(w, 3));
    const b = await call('POST', '/v1/squads', dan.token, { name: `Bio Crew ${w}` });
    const squadB = b.body.squad.id as string;
    const invB = await call('POST', `/v1/squads/${squadB}/invites`, dan.token, { maxUses: null });
    const codeB = invB.body.invite.code as string;
    // Cy belongs to B on the web but is deliberately NOT opted into context sharing for B.
    await call('POST', '/v1/invites/join', cy.token, { code: codeB });
    out.users = { rhea, ben, cy, dan };
    out.squadB = {
      id: squadB,
      invite: codeB,
      chat: CHATS[(w + 6) % 12]!,
      chatId: `group:${squadB}`,
    };
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
    if (p === '/ctl/im/say') {
      await sdk.say(b.chat, b.from, b.text, b.guid ? { id: b.guid } : {});
      await im.bridge.flush();
      return json(res, 200, { ok: true, last: sdk.log[sdk.log.length - 1]?.id });
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
      const n = await sdk.backfill();
      await im.bridge.flush();
      return json(res, 200, { delivered: n });
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
    if (p === '/ctl/im/log') return json(res, 200, { log: sdk.log });
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
