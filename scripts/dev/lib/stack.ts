/**
 * Shared stack runner for `pnpm dev:all` (Vite dev server) and `pnpm demo:serve` (production build + static server):
 * env wiring, port-busy check, health checks, prefixed logs and shutdown by exact process groups. Secrets are never printed.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../demo/lib/env';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STUDENTS = ['s_ana', 's_ben', 's_chi', 's_dev'] as const;

export interface Svc {
  name: string;
  color: number;
  cmd: string[];
  env: NodeJS.ProcessEnv;
  health: string;
  url: string;
  port: number;
}

export interface StackOptions {
  /** e.g. "dev" / "demo (built)" for the banner. */
  label: string;
  args: Set<string>;
  /** Flag that skips the web service (dev:all: --no-web). */
  noWebFlag?: string;
  /** Flag that skips the hub (demo:serve: --no-hub). */
  noHubFlag?: string;
  /** Builds the web service definition. */
  web: (ctx: StackCtx) => Svc;
  /** Runs after the port check and before anything starts (e.g. the production build). */
  prepare?: (ctx: StackCtx) => Promise<void>;
}

export interface StackCtx {
  hubUrl: string;
  webUrl: string;
  hubPort: number;
  webPort: number;
  baseEnv: NodeJS.ProcessEnv;
  /** Runs a command to completion in its own process group (killed on shutdown); prefixed output. */
  runStep: (name: string, cmd: string[], env: NodeJS.ProcessEnv) => Promise<number>;
}

export const paint = (c: number, s: string) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);

export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port);
  });
}

export function runStack(opts: StackOptions): void {
  const { args } = opts;
  const { env: fileEnv } = loadEnv();
  const get = (k: string): string | undefined => process.env[k] || fileEnv[k] || undefined;

  const HUB_PORT = Number(process.env.DEV_ALL_HUB_PORT || 8788);
  const WEB_PORT = Number(process.env.DEV_ALL_WEB_PORT || 5180);
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

  const procs: ChildProcess[] = [];
  let stopping = false;
  const tagFor = (name: string, color: number) => paint(color, name.padEnd(9));

  function spawnProc(svc: { name: string; color: number; cmd: string[]; env: NodeJS.ProcessEnv }) {
    const child = spawn(svc.cmd[0]!, svc.cmd.slice(1), {
      cwd: ROOT,
      env: svc.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group so Ctrl-C can reap tsx/vite grandchildren
    });
    const tag = tagFor(svc.name, svc.color);
    const pipe = (buf: Buffer) => {
      for (const line of buf.toString().split(/\r?\n/))
        if (line.trim()) process.stdout.write(`${tag} ${line}\n`);
    };
    child.stdout?.on('data', pipe);
    child.stderr?.on('data', pipe);
    procs.push(child);
    return { child, tag };
  }

  function start(svc: Svc): ChildProcess {
    const { child, tag } = spawnProc(svc);
    child.on('exit', (code, sig) => {
      if (stopping) return;
      console.error(`${tag} exited (${sig ?? code}); shutting everything down`);
      void shutdown(1);
    });
    return child;
  }

  function runStep(name: string, cmd: string[], env: NodeJS.ProcessEnv): Promise<number> {
    return new Promise((resolve) => {
      const { child } = spawnProc({ name, color: 34, cmd, env });
      child.on('exit', (code) => resolve(code ?? 1));
    });
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

  const ctx: StackCtx = { hubUrl, webUrl, hubPort: HUB_PORT, webPort: WEB_PORT, baseEnv, runStep };

  const hubSvc: Svc = {
    name: 'hub',
    color: 36,
    cmd: ['pnpm', '--filter', '@squad/hub', 'start'],
    env: baseEnv,
    health: `${hubUrl}/health`,
    url: hubUrl,
    port: HUB_PORT,
  };
  const agentSvcs: Svc[] = args.has('--no-agents')
    ? []
    : STUDENTS.map((id) => ({
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
      }));
  const withHub = !(opts.noHubFlag && args.has(opts.noHubFlag));
  const withWeb = !(opts.noWebFlag && args.has(opts.noWebFlag));
  const services: Svc[] = [
    ...(withHub ? [hubSvc] : []),
    ...agentSvcs,
    ...(withWeb ? [opts.web(ctx)] : []),
  ];

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

    await opts.prepare?.(ctx);
    if (stopping) return;

    // Hub first (agents post to it), then agents in parallel, then the web host.
    if (withHub) {
      start(hubSvc);
      if (!(await waitHealthy(hubSvc))) {
        console.error('hub did not become healthy within 60 s');
        return shutdown(1);
      }
      console.log(paint(32, `ok  hub ${hubSvc.url}`));
    } else if (!(await waitHealthy(hubSvc, 3000)))
      console.warn(`warning: no hub answering ${hubSvc.health} (started with --no-hub)`);

    const rest = services.filter((s) => s !== hubSvc);
    for (const s of rest) start(s);
    const results = await Promise.all(rest.map(async (s) => [s, await waitHealthy(s)] as const));
    for (const [s, ok] of results) {
      if (!ok) {
        console.error(`${s.name} did not become healthy (${s.health})`);
        return shutdown(1);
      }
      console.log(paint(32, `ok  ${s.name} ${s.url}`));
    }

    console.log(`\nSquad ${opts.label} stack is up`);
    if (withWeb)
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
}
