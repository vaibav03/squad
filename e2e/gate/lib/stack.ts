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
import { CONNECTOR_ENV } from './contract';

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
  // Connectors: the hub runs its REAL Google and Canvas code. A fake OAuth client switches Google to live mode; the
  // gate hub's fetch seam sends every Google host to the fake Google server (never to Google).
  ...CONNECTOR_ENV,
  GOOGLE_OAUTH_CLIENT_ID: 'gate-fake-client-id',
  GOOGLE_OAUTH_CLIENT_SECRET: 'gate-fake-client-secret',
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

/** Phase 1: fake servers, the gate hub and the web host. The agents start in phase 2 (startAgents) because their
 *  private profiles are generated for the journey world's accounts, which exist only once the hub is up. */
export function startStack(): void {
  fs.mkdirSync(TMP, { recursive: true });
  const pids: Record<string, number> = {};
  pids.fakes = launch(
    'fakes',
    'pnpm',
    ['exec', 'tsx', 'e2e/gate/lib/fakes/fakes-main.ts'],
    baseEnv(),
  );
  pids.hub = startHubProc();
  pids.web = launch(
    'web',
    'pnpm',
    ['--filter', '@squad/web-host', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'],
    baseEnv(),
  );
  writePids(pids);
}

// ---- agents: one process per journey member, their private profile generated for the member's account id ----
/** fixture slot (the agent fixtures are keyed s_ana ...) -> the world user it is the agent of */
export const SLOT_USER: Record<string, 'rhea' | 'ben' | 'cy' | 'dan'> = {
  s_ana: 'rhea',
  s_ben: 'ben',
  s_chi: 'cy',
  s_dev: 'dan',
};
const FIXTURES = path.join(TMP, 'agent-fixtures');

export function journeyUsers(): Record<string, { id: string; name: string }> | undefined {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(TMP, 'world-journey.json'), 'utf8')) as {
        users: Record<string, { id: string; name: string }>;
      }
    ).users;
  } catch {
    return undefined;
  }
}

/** Copies the agent fixtures and re-keys the four profiles to the journey accounts (same private content). */
export function prepareAgentFixtures(): void {
  const users = journeyUsers();
  if (!users) throw new Error('journey world not created yet');
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  fs.cpSync(path.join(REPO, 'apps/agent/fixtures'), FIXTURES, { recursive: true });
  const peerMap: Record<string, string> = {};
  for (const slot of AGENT_IDS) {
    const u = users[SLOT_USER[slot]!]!;
    const prof = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slot}.json`), 'utf8'));
    fs.writeFileSync(
      path.join(FIXTURES, `${u.id}.json`),
      JSON.stringify({ ...prof, id: u.id, name: u.name }),
    );
    peerMap[u.id] = AGENT_URL(slot);
  }
  fs.writeFileSync(path.join(FIXTURES, 'peers.json'), JSON.stringify(peerMap));
}

const agentPeers = () => {
  const users = journeyUsers() ?? {};
  return AGENT_IDS.map((slot) => `${users[SLOT_USER[slot]!]?.id ?? slot}=${AGENT_URL(slot)}`).join(
    ',',
  );
};

function launchAgent(slot: string): number {
  const users = journeyUsers() ?? {};
  return launch(`agent-${slot}`, 'pnpm', ['--filter', '@squad/agent', 'start'], {
    ...baseEnv(),
    AGENT_ID: users[SLOT_USER[slot]!]?.id ?? slot,
    AGENTS_FIXTURES: FIXTURES,
    PORT: String(AGENT_PORT(slot)),
    PEERS: agentPeers(),
    FAKE_LLM: LIVE ? '0' : '1',
    CONFIRM_MODE: 'scripted',
  });
}

export function startAgents(): void {
  prepareAgentFixtures();
  const pids = readPids();
  for (const slot of AGENT_IDS) pids[slot] = launchAgent(slot);
  writePids(pids);
}

export async function stackUp(ms = 120_000, withAgents = true): Promise<boolean> {
  const checks = [
    `${HUB}/health`,
    `${WEB}/`,
    `${CTL}/ctl/health`,
    ...(withAgents ? AGENT_IDS.map((id) => `${AGENT_URL(id)}/healthz`) : []),
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
  pids[id] = launchAgent(id);
  writePids(pids);
  return waitFor(`${AGENT_URL(id)}/healthz`, 60_000);
}
