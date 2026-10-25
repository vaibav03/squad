import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AGENT_IDS,
  AGENT_PORT,
  AGENT_URL,
  HUB,
  HUB_PORT,
  LIVE,
  REPO,
  SECRET,
  TMP,
  WEB,
  WEB_PORT,
} from './env';

/**
 * The e2e stack is booted here instead of `pnpm dev:all` so that it owns its ports (hub, web host and agents on
 * E2E_AGENT_BASE..+3) and a teardown can never reap another lead's stack on 4101-4104.
 */
const peers = () => AGENT_IDS.map((id) => `${id}=${AGENT_URL(id)}`).join(',');

/** Provider keys from .env for LIVE=1 (never printed, never logged). */
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
  DB_PATH: path.join(TMP, 'hub.db'),
  INTERNAL_EVENTS_SECRET: SECRET,
  HUB_CORS_ORIGINS: `${WEB},http://127.0.0.1:${WEB_PORT}`,
  VITE_HUB_URL: HUB,
  AGENT_PEERS: peers(),
  FORCE_COLOR: '0',
  ...(LIVE ? {} : { FORCE_FAKE_LLM: '1' }),
});

export async function waitFor(url: string, ms = 60_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export function portBusy(port: number): boolean {
  try {
    return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN || true`).toString().trim().length > 0;
  } catch {
    return false;
  }
}
export const ownPorts = () => [
  HUB_PORT,
  WEB_PORT,
  ...(process.env.E2E_NO_AGENTS === '1' ? [] : AGENT_IDS.map(AGENT_PORT)),
];

function launch(name: string, args: string[], env: NodeJS.ProcessEnv): number {
  const log = fs.openSync(path.join(TMP, `${name}.log`), 'a');
  const p = spawn('pnpm', args, { cwd: REPO, env, stdio: ['ignore', log, log], detached: true });
  p.unref();
  return p.pid!;
}

export function startStack(): void {
  fs.mkdirSync(TMP, { recursive: true });
  const pids: Record<string, number> = {};
  pids.hub = launch('hub', ['--filter', '@squad/hub', 'start'], baseEnv());
  if (process.env.E2E_NO_AGENTS !== '1')
    for (const id of AGENT_IDS)
      pids[id] = launch(`agent-${id}`, ['--filter', '@squad/agent', 'start'], {
        ...baseEnv(),
        AGENT_ID: id,
        PORT: String(AGENT_PORT(id)),
        PEERS: peers(),
        FAKE_LLM: LIVE ? '0' : '1',
        CONFIRM_MODE: 'scripted',
      });
  pids.web = launch(
    'web',
    ['--filter', '@squad/web-host', 'exec', 'vite', '--port', String(WEB_PORT), '--strictPort'],
    baseEnv(),
  );
  fs.writeFileSync(path.join(TMP, 'stack.pids'), JSON.stringify(pids));
}

export async function stackUp(ms = 90_000): Promise<boolean> {
  const checks = [`${HUB}/health`, `${WEB}/`];
  if (process.env.E2E_NO_AGENTS !== '1')
    for (const id of AGENT_IDS) checks.push(`${AGENT_URL(id)}/healthz`);
  return (await Promise.all(checks.map((u) => waitFor(u, ms)))).every(Boolean);
}

/** Kills ONLY the process groups this module spawned (PIDs recorded in e2e/.tmp/stack.pids). Never port- or pattern-based. */
export function stopStack(): void {
  try {
    const pids = JSON.parse(fs.readFileSync(path.join(TMP, 'stack.pids'), 'utf8')) as Record<
      string,
      number
    >;
    for (const pid of Object.values(pids)) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        /* gone */
      }
    }
  } catch {
    /* never started */
  }
}
