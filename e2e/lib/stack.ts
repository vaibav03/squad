import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HUB, HUB_PORT, LIVE, REPO, SECRET, TMP, WEB_PORT } from './env';

export const stackEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  DEV_ALL_HUB_PORT: String(HUB_PORT),
  DEV_ALL_WEB_PORT: String(WEB_PORT),
  DB_PATH: path.join(TMP, 'hub.db'),
  INTERNAL_EVENTS_SECRET: SECRET,
  ...(LIVE ? {} : { FORCE_FAKE_LLM: '1' }),
});

export async function waitFor(url: string, ms = 60_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
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

export function startStack(): ChildProcess {
  fs.mkdirSync(TMP, { recursive: true });
  const log = fs.openSync(path.join(TMP, 'stack.log'), 'w');
  const p = spawn('pnpm', ['dev:all', ...(process.env.E2E_NO_AGENTS === '1' ? ['--no-agents'] : [])], {
    cwd: REPO,
    env: stackEnv(),
    stdio: ['ignore', log, log],
    detached: true,
  });
  fs.writeFileSync(path.join(TMP, 'stack.pid'), String(p.pid));
  return p;
}

/** Kills only the hub process (the one listening on HUB_PORT). */
export function killHub(): void {
  execSync(`lsof -tiTCP:${HUB_PORT} -sTCP:LISTEN | xargs kill -9 || true`);
}

/** Restarts the hub with the stack's env (same DB file, same ports). Returns once /health answers. */
export async function startHub(): Promise<void> {
  const log = fs.openSync(path.join(TMP, 'hub-restart.log'), 'a');
  const p = spawn('pnpm', ['--filter', '@squad/hub', 'start'], {
    cwd: REPO,
    env: {
      ...stackEnv(),
      HUB_PORT: String(HUB_PORT),
      HUB_BASE_URL: HUB,
      AGENT_PEERS: ['s_ana=4101', 's_ben=4102', 's_cam=4103', 's_dev=4104']
        .map((x) => x.replace('=', '=http://localhost:'))
        .join(','),
      HUB_CORS_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
    },
    stdio: ['ignore', log, log],
    detached: true,
  });
  p.unref();
  if (!(await waitFor(`${HUB}/health`, 40_000))) throw new Error('hub did not come back');
}

export function stopStack(): void {
  try {
    const pid = Number(fs.readFileSync(path.join(TMP, 'stack.pid'), 'utf8'));
    if (pid) process.kill(-pid, 'SIGINT');
  } catch {
    /* already gone */
  }
  const agentPorts = process.env.E2E_NO_AGENTS === '1' ? [] : [4101, 4102, 4103, 4104];
  for (const port of [HUB_PORT, WEB_PORT, ...agentPorts]) {
    try {
      execSync(`lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill || true`);
    } catch {
      /* ignore */
    }
  }
}
