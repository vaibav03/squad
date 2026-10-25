/**
 * pnpm dev:all: boots the whole dev stack with one command and shuts it down on Ctrl-C.
 *
 *   hub       http://localhost:8788   (apps/hub, real brain/media ports when GEMINI_API_KEY is set, stubs otherwise)
 *   agents    http://localhost:4101-4104 (apps/agent, one per demo student)
 *   web host  http://localhost:5180   (apps/web-host, Vite)
 *
 * Env wiring (values come from .env, the shell, then these dev defaults; secrets are never printed):
 *   INTERNAL_EVENTS_SECRET  dev default "dev-internal-secret" (same value for hub and agents)
 *   HUB_BASE_URL            http://localhost:8788
 *   HUB_CORS_ORIGINS        web host origin(s) added to whatever is already set
 *   VITE_HUB_URL            http://localhost:8788 (read by apps/web-host)
 *   FAKE_LLM                agents use the Gemini client only when GEMINI_API_KEY is set (FAKE_LLM=0), else FakeLlm
 *   CONFIRM_MODE            scripted (agents never block on stdin) unless BOT_URL is set
 *
 * Flags: --no-web, --no-agents. Env: DEV_ALL_HUB_PORT, DEV_ALL_WEB_PORT, DEV_ALL_AGENT_PORT_BASE (default 4101).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../demo/lib/env';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));

const { env: fileEnv } = loadEnv();
const get = (k: string): string | undefined => process.env[k] || fileEnv[k] || undefined;

const HUB_PORT = Number(process.env.DEV_ALL_HUB_PORT || 8788);
const WEB_PORT = Number(process.env.DEV_ALL_WEB_PORT || 5180);
const STUDENTS = ['s_ana', 's_ben', 's_chi', 's_dev'] as const;
const AGENT_BASE = Number(process.env.DEV_ALL_AGENT_PORT_BASE || 4101);
const AGENT_PORTS: Record<string, number> = Object.fromEntries(
  STUDENTS.map((id, i) => [id, AGENT_BASE + i]),
);
const hubUrl = `http://localhost:${HUB_PORT}`;
const webUrl = `http://localhost:${WEB_PORT}`;

const usingDefaultSecret = !get('INTERNAL_EVENTS_SECRET');
const secret = get('INTERNAL_EVENTS_SECRET') ?? 'dev-internal-secret';
const realLlm = Boolean(get('GEMINI_API_KEY'));
const cors = [
  ...new Set(
    [
      ...(get('HUB_CORS_ORIGINS') ?? 'http://localhost:5173,http://localhost:4173').split(','),
      webUrl,
      `http://127.0.0.1:${WEB_PORT}`,
    ]
      .map((s) => s.trim())
      .filter(Boolean),
  ),
].join(',');

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  INTERNAL_EVENTS_SECRET: secret,
  HUB_BASE_URL: hubUrl,
  HUB_PORT: String(HUB_PORT),
  HUB_CORS_ORIGINS: cors,
  // The web origin actually served (never the 5173 default that may lead the CORS list): fallback for OAuth returns, invite and iMessage links.
  HUB_WEB_URL: get('HUB_WEB_URL') ?? get('PUBLIC_WEB_URL') ?? webUrl,
  VITE_HUB_URL: hubUrl,
  // Provider keys from .env reach the children (the hub and core read .env themselves too).
  ...(get('GEMINI_API_KEY') ? { GEMINI_API_KEY: get('GEMINI_API_KEY') } : {}),
  ...(get('ELEVENLABS_API_KEY') ? { ELEVENLABS_API_KEY: get('ELEVENLABS_API_KEY') } : {}),
  AGENT_PEERS: STUDENTS.map((id) => `${id}=http://localhost:${AGENT_PORTS[id]}`).join(','),
  FORCE_COLOR: '0',
};

interface Svc {
  name: string;
  color: number;
  cmd: string[];
  env: NodeJS.ProcessEnv;
  health: string;
  url: string;
  port: number;
}

const services: Svc[] = [
  {
    name: 'hub',
    color: 36,
    cmd: ['pnpm', '--filter', '@squad/hub', 'start'],
    env: baseEnv,
    health: `${hubUrl}/health`,
    url: hubUrl,
    port: HUB_PORT,
  },
];
if (!args.has('--no-agents'))
  for (const id of STUDENTS)
    services.push({
      name: id.replace('s_', 'agent-'),
      color: 35,
      cmd: ['pnpm', '--filter', '@squad/agent', 'start'],
      env: {
        ...baseEnv,
        AGENT_ID: id,
        PORT: String(AGENT_PORTS[id]),
        FAKE_LLM: realLlm ? '0' : '1',
        ...(process.env.BOT_URL || fileEnv.BOT_URL ? {} : { CONFIRM_MODE: 'scripted' }),
      },
      health: `http://localhost:${AGENT_PORTS[id]}/healthz`,
      url: `http://localhost:${AGENT_PORTS[id]}`,
      port: AGENT_PORTS[id]!,
    });
if (!args.has('--no-web'))
  services.push({
    name: 'web',
    color: 33,
    cmd: [
      'pnpm',
      '--filter',
      '@squad/web-host',
      'exec',
      'vite',
      '--port',
      String(WEB_PORT),
      '--strictPort',
    ],
    env: baseEnv,
    health: `${webUrl}/`,
    url: webUrl,
    port: WEB_PORT,
  });

const paint = (c: number, s: string) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const procs: ChildProcess[] = [];
let stopping = false;

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port);
  });
}

function start(svc: Svc): ChildProcess {
  const child = spawn(svc.cmd[0]!, svc.cmd.slice(1), {
    cwd: ROOT,
    env: svc.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group so Ctrl-C can reap tsx/vite grandchildren
  });
  const tag = paint(svc.color, svc.name.padEnd(9));
  const pipe = (buf: Buffer) => {
    for (const line of buf.toString().split(/\r?\n/))
      if (line.trim()) process.stdout.write(`${tag} ${line}\n`);
  };
  child.stdout?.on('data', pipe);
  child.stderr?.on('data', pipe);
  child.on('exit', (code, sig) => {
    if (stopping) return;
    console.error(`${tag} exited (${sig ?? code}); shutting everything down`);
    void shutdown(1);
  });
  procs.push(child);
  return child;
}

async function waitHealthy(svc: Svc, timeoutMs = 60_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && !stopping) {
    try {
      const res = await fetch(svc.health, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function shutdown(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log('\nshutting down...');
  for (const p of procs)
    if (p.pid)
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && procs.some((p) => p.exitCode === null && p.signalCode === null))
    await new Promise((r) => setTimeout(r, 100));
  for (const p of procs)
    if (p.pid && p.exitCode === null)
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
  process.exit(code);
}

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

async function main() {
  const busy: string[] = [];
  for (const s of services) if (!(await portFree(s.port))) busy.push(`${s.name} :${s.port}`);
  if (busy.length) {
    console.error(
      `ports already in use: ${busy.join(', ')}\nStop whatever holds them (lsof -nP -iTCP:<port> -sTCP:LISTEN) and retry.`,
    );
    process.exit(1);
  }

  console.log(
    `mode: ${realLlm ? 'REAL Gemini (GEMINI_API_KEY present)' : 'STUB (no GEMINI_API_KEY: hub uses stub ports, agents use FakeLlm)'}; ` +
      `ElevenLabs ${get('ELEVENLABS_API_KEY') ? 'key present' : 'key missing (calls are caption-only)'}`,
  );
  if (usingDefaultSecret)
    console.log(
      'INTERNAL_EVENTS_SECRET not set: using the dev default (never use it outside localhost)',
    );

  // Hub first (agents post to it), then agents in parallel, then the web host.
  const hub = services[0]!;
  start(hub);
  if (!(await waitHealthy(hub))) {
    console.error('hub did not become healthy within 60 s');
    return shutdown(1);
  }
  console.log(paint(32, `ok  hub ${hub.url}`));

  const rest = services.slice(1);
  for (const s of rest) start(s);
  const results = await Promise.all(rest.map(async (s) => [s, await waitHealthy(s)] as const));
  for (const [s, ok] of results) {
    if (!ok) {
      console.error(`${s.name} did not become healthy (${s.health})`);
      return shutdown(1);
    }
    console.log(paint(32, `ok  ${s.name} ${s.url}`));
  }

  console.log('\nSquad dev stack is up');
  console.log(`  web host   ${webUrl}/            (village: ${webUrl}/squad/village)`);
  console.log(`  hub        ${hubUrl}/health      (status: ${hubUrl}/v1/status)`);
  for (const s of rest.filter((r) => r.name.startsWith('agent')))
    console.log(`  ${s.name.padEnd(10)} ${s.url}/healthz`);
  console.log(
    'Ctrl-C stops everything. Run `pnpm doctor` in another terminal for a key/tool report.',
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  void shutdown(1);
});
