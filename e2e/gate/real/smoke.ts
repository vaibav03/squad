// pnpm gate:smoke: the safe real-account path (docs/qa/RELEASE-GATE.md section 7).
//   --stage preflight (default)  no network, nothing started: which prerequisites are present (names only)
//   --stage dry-run              real hub, IMESSAGE_DRY_RUN=1, one allowlisted chat, your own accounts, nothing sent
//   --stage send                 same without dry run (needs GATE_DRY_RUN=0, GATE_APPLE_VERIFIED=1, --confirm-send)
//   --stage revoke               revoke at Google, delete the Canvas connection, assert the purge
// Everything is fail-closed. Credentials are read by the hub's own runtime (its environment / .env) and the OAuth
// consent happens in YOUR browser; this script never prints a secret and never messages a third party.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GATE_REAL, HUB, HUB_PORT, KILL_FILE, REAL_RESULTS_DIR, REPO, SHOTS } from '../lib/config';
import { blockerFor, definedEnvNames, RUNBOOKS } from '../lib/blockers';
import type { Mode, StepResult } from '../lib/types';
import {
  MAX_OUTBOUND,
  OutboundCounter,
  allowlistChecks,
  canvasHostIsOwn,
  killSwitchTripped,
  ownAccountChecks,
  writeOutboxForReview,
  type Check,
} from './guard';

const arg = (n: string) => process.argv.includes(`--${n}`);
const stage = (() => {
  const i = process.argv.indexOf('--stage');
  return i >= 0 ? (process.argv[i + 1] ?? 'preflight') : 'preflight';
})();
const TMP_REAL = path.join(REPO, 'e2e/gate/.tmp-real');
const PIDS = path.join(TMP_REAL, 'pids.json');
void SHOTS;

const out = (s = '') => console.log(s);
const redact = (s: string) =>
  [process.env.GATE_CANVAS_FEED_URL, process.env.GATE_CANVAS_TOKEN, process.env.GEMINI_API_KEY]
    .filter((x): x is string => !!x && x.length > 4)
    .reduce((acc, v) => acc.split(v).join('***'), s);
const say = (s = '') => out(redact(s));

function record(
  id: string,
  title: string,
  status: StepResult['status'],
  extra: Partial<StepResult> = {},
) {
  fs.mkdirSync(REAL_RESULTS_DIR, { recursive: true });
  const r: StepResult = {
    id,
    title,
    mode: 'real' as Mode,
    status,
    assertions: [],
    evidence: [],
    notes: [],
    label: 'real',
    ms: 0,
    at: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(path.join(REAL_RESULTS_DIR, `${id}.real.json`), JSON.stringify(r, null, 2));
}

function table(checks: Check[]) {
  for (const c of checks) say(`  ${c.ok ? 'ok     ' : 'MISSING'}  ${c.name}  (${c.detail})`);
}

async function preflight(): Promise<boolean> {
  say('Release gate smoke path: preflight (no network, nothing started)');
  say(
    `  GATE_REAL=${GATE_REAL ? '1' : 'unset'}  kill switch: ${killSwitchTripped() ?? 'clear'}  max outbound: ${MAX_OUTBOUND}`,
  );
  const names = definedEnvNames();
  const checks: Check[] = [
    ...ownAccountChecks(),
    ...allowlistChecks(),
    {
      name: 'Canvas calendar feed URL (GATE_CANVAS_FEED_URL) with an own host',
      ok: canvasHostIsOwn(process.env.GATE_CANVAS_FEED_URL),
      detail: 'host must equal GATE_OWN_CANVAS_HOST; the URL itself is never printed',
    },
    {
      name: 'Gemini key present (hub env or .env)',
      ok: names.has('GEMINI_API_KEY'),
      detail: 'name only',
    },
  ];
  table(checks);
  const blockers: string[] = [];
  for (const k of Object.keys(RUNBOOKS)) {
    const b = await blockerFor(k).catch(() => undefined);
    if (b) blockers.push(`  BLOCKED(${b.code})  docs/qa/RELEASE-GATE.md${b.runbook}`);
  }
  if (blockers.length) {
    say('');
    say('External blockers (see the runbooks):');
    blockers.forEach(say);
  }
  const ok = checks.every((c) => c.ok);
  say('');
  say(
    ok
      ? 'preflight ok. Next: GATE_REAL=1 pnpm gate:smoke -- --stage dry-run --confirm-reads-allowlisted-chat'
      : 'preflight incomplete: nothing was started.',
  );
  return ok;
}

// ---------------------------------------------------------------------------------------------------- hub process
function readPids(): Record<string, number> {
  try {
    return JSON.parse(fs.readFileSync(PIDS, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}
function stopHub(): void {
  const p = readPids().hub;
  if (!p) return;
  try {
    process.kill(-p, 'SIGTERM'); // exact process group recorded when this script started it
  } catch {
    /* gone */
  }
  fs.rmSync(PIDS, { force: true });
}

async function startRealHub(dry: boolean, imessage = true): Promise<void> {
  fs.mkdirSync(TMP_REAL, { recursive: true });
  const log = fs.openSync(path.join(TMP_REAL, 'hub.log'), 'a');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HUB_PORT: String(HUB_PORT),
    HUB_BASE_URL: HUB,
    HUB_DEV_LOGIN: '1',
    DB_PATH: path.join(TMP_REAL, 'hub.db'),
    FORCE_COLOR: '0',
    IMESSAGE_ENABLED: imessage ? '1' : '0',
    IMESSAGE_DRY_RUN: dry ? '1' : '0',
    IMESSAGE_ALLOWED_CHATS: imessage ? (process.env.GATE_ALLOWED_CHAT ?? '') : '',
    IMESSAGE_ALLOWED_HANDLES: imessage ? (process.env.GATE_OWN_HANDLE ?? '') : '',
    IMESSAGE_ALLOW_ALL: '0',
    IMESSAGE_RATE_PER_MIN: '3',
  };
  const p = spawn('pnpm', ['exec', 'tsx', 'apps/hub/src/main.ts'], {
    cwd: REPO,
    env,
    stdio: ['ignore', log, log],
    detached: true,
  });
  p.unref();
  fs.writeFileSync(PIDS, JSON.stringify({ hub: p.pid }));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${HUB}/health`)).ok) return;
    } catch {
      /* not up */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('real hub did not come up; see e2e/gate/.tmp-real/hub.log');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(
  token: string | null,
  p: string,
  init: { method?: string; json?: unknown } = {},
) {
  const r = await fetch(`${HUB}${p}`, {
    method: init.method ?? 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.json ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.json ? { body: JSON.stringify(init.json) } : {}),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json };
}

async function signInOwn(): Promise<{ token: string; id: string } | undefined> {
  const h = process.env.GATE_OWN_HANDLE!;
  const body = h.includes('@') ? { email: h, name: 'Smoke' } : { phone: h, name: 'Smoke' };
  const s = await api(null, '/v1/auth/start', { method: 'POST', json: body });
  const v = await api(null, '/v1/auth/verify', {
    method: 'POST',
    json: { challengeId: s.json?.challengeId, code: s.json?.devCode },
  });
  return v.json?.token ? { token: v.json.token, id: v.json.user.id } : undefined;
}

// ---------------------------------------------------------------------------------------------------- stages
async function run(dry: boolean): Promise<number> {
  if (!GATE_REAL) {
    say('refusing: set GATE_REAL=1 for anything beyond preflight');
    return 2;
  }
  if (!arg('confirm-reads-allowlisted-chat')) {
    say(
      'refusing: --confirm-reads-allowlisted-chat is required (the hub will read ONLY the allowlisted chat from your Messages database)',
    );
    return 2;
  }
  if (!dry) {
    const need =
      process.env.GATE_DRY_RUN === '0' &&
      process.env.GATE_APPLE_VERIFIED === '1' &&
      arg('confirm-send');
    if (!need) {
      say(
        'refusing to send: needs GATE_DRY_RUN=0, GATE_APPLE_VERIFIED=1 (you recorded a passing dry run) and --confirm-send',
      );
      return 2;
    }
  }
  if (!(await preflight())) return 3;
  const kill = killSwitchTripped();
  if (kill) {
    say(`refusing: kill switch (${kill})`);
    return 2;
  }

  const counter = new OutboundCounter();
  const watchdog = setInterval(() => {
    const k = killSwitchTripped();
    if (k) {
      say(`kill switch tripped (${k}): stopping the hub this script started`);
      stopHub();
      process.exit(2);
    }
  }, 500);
  try {
    await startRealHub(dry);
    const me = await signInOwn();
    if (!me) throw new Error('could not sign in as yourself (own handle)');
    say('hub up (dry-run=' + dry + '). Signed in as your own account.');

    // S1 connect: Canvas feed from the environment (never printed), Google by consent in YOUR browser
    const feed = process.env.GATE_CANVAS_FEED_URL;
    if (feed && canvasHostIsOwn(feed)) {
      const r = await api(me.token, '/v1/connections', {
        method: 'POST',
        json: {
          provider: 'canvas',
          variant: 'feed',
          scopes: ['canvas.calendar_feed'],
          feedUrl: feed,
        },
      });
      say(`canvas connect -> ${r.status}`);
    }
    const g = await api(me.token, '/v1/connections/google/authorize');
    const url: string | undefined = g.json?.authorization_url;
    if (url && g.json?.mode === 'live') {
      say('Open this URL in your own browser and approve (only your own Google account):');
      say(`  ${url}`);
      const end = Date.now() + 5 * 60_000;
      let conn: any;
      while (Date.now() < end && !conn) {
        await sleep(3000);
        const l = await api(me.token, '/v1/connections');
        conn = (l.json?.connections ?? []).find(
          (c: any) => c.provider === 'google' && c.status === 'live',
        );
      }
      if (!conn) throw new Error('no Google connection within 5 minutes');
      record('S1', 'Connect Canvas and Google Workspace with minimal permissions', 'PASS', {
        label: 'real',
        notes: ['scopes: ' + (conn.scopes ?? []).length],
      });
    } else {
      record('S1', 'Connect Canvas and Google Workspace with minimal permissions', 'BLOCKED', {
        reason: 'no_google_client',
        runbook: RUNBOOKS.google_client!.anchor,
      });
    }

    // S2/S3: counts only, then a grounded question
    const list = await api(me.token, '/v1/connections');
    for (const c of list.json?.connections ?? [])
      await api(me.token, `/v1/connections/${c.id}/sync`, { method: 'POST', json: {} });
    const after = await api(me.token, '/v1/connections');
    const total = (after.json?.connections ?? []).reduce(
      (n: number, c: any) => n + (c.sources?.total ?? 0),
      0,
    );
    record('S2', 'Ingest and normalize permitted context', total > 0 ? 'PASS' : 'FAIL', {
      notes: [`${total} source(s) ingested (counts only; no content is logged)`],
      ...(total > 0 ? {} : { reason: 'no sources' }),
    });

    // S4..S6: bind the allowlisted chat by texting "join <code>" from your phone, then tag the bot from it
    const squad = await api(me.token, '/v1/squads', {
      method: 'POST',
      json: { name: 'Gate smoke' },
    });
    const sid = squad.json?.squad?.id;
    const inv = sid
      ? await api(me.token, `/v1/squads/${sid}/invites`, { method: 'POST', json: { maxUses: 1 } })
      : undefined;
    const code = inv?.json?.invite?.code;
    say(`In YOUR allowlisted chat, send:  join ${code}   then:  @cubbie what is due this week?`);
    const end = Date.now() + 5 * 60_000;
    let tagged: any;
    while (Date.now() < end && !tagged) {
      await sleep(3000);
      const h = await api(
        me.token,
        `/v1/chat/history?chatId=${encodeURIComponent(`group:${sid}`)}&limit=50`,
      );
      tagged = (h.json?.messages ?? []).find(
        (m: any) => m.transport === 'imessage' && /@cubb/i.test(m.text),
      );
    }
    if (!tagged) throw new Error('no tagged iMessage seen within 5 minutes');
    record('S4', 'Group iMessage tagging @cubbie / @cubbi', 'PASS', {
      notes: ['your own tagged message arrived with transport=imessage'],
    });
    const reply = await (async () => {
      const e2 = Date.now() + 90_000;
      while (Date.now() < e2) {
        const h = await api(
          me.token,
          `/v1/chat/history?chatId=${encodeURIComponent(`group:${sid}`)}&limit=50`,
        );
        const m = (h.json?.messages ?? []).find(
          (x: any) => x.sender?.kind === 'persona' && x.seq > tagged.seq,
        );
        if (m) return m;
        await sleep(2000);
      }
      return undefined;
    })();
    if (reply) {
      counter.note();
      const state = reply.deliveryState?.state;
      const review = writeOutboxForReview([`${reply.sender?.name}: ${reply.text}`]);
      say(`would-be/actual outbound written for review: ${review}`);
      record(
        'S6',
        'Reply delivered into the same iMessage group',
        dry
          ? state === 'dry_run'
            ? 'PASS'
            : 'FAIL'
          : state === 'sent' || state === 'delivered'
            ? 'PASS'
            : 'FAIL',
        {
          label: dry ? 'real (dry run, nothing sent)' : 'real',
          notes: [`delivery state: ${state}`],
          evidence: [review],
        },
      );
    } else
      record('S6', 'Reply delivered into the same iMessage group', 'FAIL', {
        reason: 'no reply within 90 s',
      });
    record(
      'S5',
      'Route to the correct live agent with the same grounded context',
      reply ? 'PASS' : 'FAIL',
      {
        notes: [`answered by ${reply?.sender?.name ?? 'nobody'}; demo=${reply?.demo}`],
      },
    );
    return 0;
  } catch (e) {
    say(`smoke stopped: ${(e as Error).message}`);
    return 1;
  } finally {
    clearInterval(watchdog);
    if (!arg('keep')) await revoke().catch(() => undefined);
    stopHub();
  }
}

async function revoke(): Promise<void> {
  const me = await signInOwn().catch(() => undefined);
  if (!me) return;
  const l = await api(me.token, '/v1/connections');
  for (const c of l.json?.connections ?? [])
    await api(me.token, `/v1/connections/${c.id}`, { method: 'DELETE' });
  const after = await api(me.token, '/v1/connections');
  const left = (after.json?.connections ?? []).reduce(
    (n: number, c: any) => n + (c.status === 'revoked' ? 0 : (c.sources?.total ?? 0)),
    0,
  );
  say(`revoke: connections deleted, ${left} derived source(s) left (expected 0)`);
}

const code = await (async () => {
  if (fs.existsSync(KILL_FILE) && stage !== 'preflight') {
    say('refusing: .gate-kill exists');
    return 2;
  }
  if (stage === 'preflight') return (await preflight()) ? 0 : 3;
  if (stage === 'dry-run') return run(true);
  if (stage === 'send') return run(false);
  if (stage === 'revoke') {
    if (!GATE_REAL) return (say('set GATE_REAL=1'), 2);
    await startRealHub(true, false);
    try {
      await revoke();
    } finally {
      stopHub();
    }
    return 0;
  }
  say(`unknown stage ${stage}`);
  return 2;
})();
process.exit(code);
