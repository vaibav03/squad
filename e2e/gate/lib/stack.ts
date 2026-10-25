// The gate stack: hub (gate-hub with the scripted iMessage), 4 agents, web host, fake Canvas + Google. Own ports only.
// Teardown is PID-scoped: only the process groups recorded in .tmp/stack.pids by THIS module are signalled.
// Never port-based, never pattern-based.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_IDS,
  AGENT_PORT,
  AGENT_URL,
  CANVAS,
  CTL,
  CTL_PORT,
  GOOGLE,
  GOOGLE_PORT,
  CANVAS_PORT,
  HUB,
  HUB_PORT,
  LIVE,
  REPO,
  SECRET,
  TMP,
  WEB,
  WEB_PORT,
} from './config';
import { portBusy, waitFor } from '../../lib/stack';

const peers = () => AGENT_IDS.map((id) => `${id}=${AGENT_URL(id)}`).join(',');
const PIDS = path.join(TMP, 'stack.pids');

/** Provider keys from .env, only for LIVE=1. They go to child env, never to logs or the report. */
function dotenvKeys(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!LIVE) return out;
  try {
    for (const l of fs.readFileSync(path.join(REPO, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^(?:export\s+)?(GEMINI_API_KEY|ELEVENLABS_API_KEY)\s*=\s*["']?([^"'\s#]+)/.exec(l);
      if (m) out[m[1]!] = m[2]!;
    }
  } catch {
    /* no .env */
  }
  return out;
}

export const baseEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  ...dotenvKeys(),
  HUB_PORT: String(HUB_PORT),
  HUB_BASE_URL: HUB,
  HUB_WEB_URL: WEB,
  HUB_DEV_LOGIN: '1',
  DB_PATH: path.join(TMP, 'hub.db'),
  INTERNAL_EVENTS_SECRET: SECRET,
  HUB_CORS_ORIGINS: `${WEB},http://127.0.0.1:${WEB_PORT}`,
  VITE_HUB_URL: HUB,
  AGENT_PEERS: peers(),
  FORCE_COLOR: '0',
  GATE_TMP: TMP,
  GATE_CTL_PORT: String(CTL_PORT),
  // Connector contract for the feature leads (docs/qa/RELEASE-GATE.md "Env contract"): the hub must read these so the
  // gate can point it at the fakes. Unknown to main today, harmless there.
  GOOGLE_CLIENT_ID: 'gate-fake-client',
  GOOGLE_CLIENT_SECRET: 'gate-fake-secret',
  GOOGLE_AUTH_URL: `${GOOGLE}/o/oauth2/v2/auth`,
  GOOGLE_TOKEN_URL: `${GOOGLE}/token`,
  GOOGLE_REVOKE_URL: `${GOOGLE}/revoke`,
  GOOGLE_API_BASE: GOOGLE,
  GOOGLE_REDIRECT_URI: `${HUB}/v1/connect/google/callback`,
  CANVAS_ALLOWED_HOSTS: 'localhost',
  CONNECTIONS_KEY: 'gate-only-encryption-key-not-a-secret-0123456789',
  ...(LIVE ? {} : { FORCE_FAKE_LLM: '1' }),
});

function launch(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): number {
  const log = fs.openSync(path.join(TMP, `${name}.log`), 'a');
  const p = spawn(cmd, args, { cwd: REPO, env, stdio: ['ignore', log, log], detached: true });
  p.unref();
  return p.pid!;
}

const readPids = (): Record<string, number> => {
  try {
    return JSON.parse(fs.readFileSync(PIDS, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
};
const writePids = (p: Record<string, number>) => fs.writeFileSync(PIDS, JSON.stringify(p));

export const ownPorts = () => [
  HUB_PORT,
  WEB_PORT,
  CTL_PORT,
  CANVAS_PORT,
  GOOGLE_PORT,
  ...AGENT_IDS.map(AGENT_PORT),
];

function startHubProc(): number {
  return launch('hub', 'pnpm', ['exec', 'tsx', 'e2e/gate/lib/gate-hub.ts'], baseEnv());
}

export function startStack(): void {
  fs.mkdirSync(TMP, { recursive: true });
  const pids: Record<string, number> = {};
  pids.fakes = launch('fakes', 'pnpm', ['exec', 'tsx', 'e2e/gate/lib/fakes/fakes-main.ts'], baseEnv());
  pids.hub = startHubProc();
  for (const id of AGENT_IDS)
    pids[id] = launch(`agent-${id}`, 'pnpm', ['--filter', '@squad/agent', 'start'], {
      ...baseEnv(),
      AGENT_ID: id,
      PORT: String(AGENT_PORT(id)),
      PEERS: peers(),
      FAKE_LLM: LIVE ? '0' : '1',
      CONFIRM_MODE: 'scripted',
    });
  pids.web = launch(
    'web',
    'pnpm',
    ['--filter', '@squad/web-host', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'],
    baseEnv(),
  );
  writePids(pids);
}

export async function stackUp(ms = 120_000): Promise<boolean> {
  const checks = [
    `${HUB}/health`,
    `${WEB}/`,
    `${CTL}/ctl/health`,
    ...AGENT_IDS.map((id) => `${AGENT_URL(id)}/healthz`),
  ];
  const ok = (await Promise.all(checks.map((u) => waitFor(u, ms)))).every(Boolean);
  // fakes have no health route; a 404 still proves they listen
  for (const u of [`${CANVAS}/_ctl/requests`, `${GOOGLE}/_ctl/requests`])
    if (!(await waitFor(u, 30_000))) return false;
  return ok;
}

/** Stops and restarts ONLY the hub process this module started (V7 hub restart). The DB file persists. */
export async function restartHub(): Promise<boolean> {
  const pids = readPids();
  if (pids.hub) {
    try {
      process.kill(-pids.hub, 'SIGTERM');
    } catch {
      /* gone */
    }
    for (let i = 0; i < 40 && portBusy(HUB_PORT); i++) await new Promise((r) => setTimeout(r, 250));
  }
  pids.hub = startHubProc();
  writePids(pids);
  return (await waitFor(`${HUB}/health`, 60_000)) && (await waitFor(`${CTL}/ctl/health`, 60_000));
}

/** Signals ONLY the process groups recorded by startStack (exact PIDs). */
export function stopStack(): void {
  for (const pid of Object.values(readPids())) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* gone */
    }
  }
}

/** Stops ONE agent process group (exact PID recorded at startStack) to simulate an agent going offline. */
export function stopAgent(id: string): void {
  const pid = readPids()[id];
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* gone */
  }
}

/** Starts that agent again and records its new PID. */
export async function startAgent(id: string): Promise<boolean> {
  const pids = readPids();
  pids[id] = launch(`agent-${id}`, 'pnpm', ['--filter', '@squad/agent', 'start'], {
    ...baseEnv(),
    AGENT_ID: id,
    PORT: String(AGENT_PORT(id)),
    PEERS: peers(),
    FAKE_LLM: LIVE ? '0' : '1',
    CONFIRM_MODE: 'scripted',
  });
  writePids(pids);
  return waitFor(`${AGENT_URL(id)}/healthz`, 60_000);
}
