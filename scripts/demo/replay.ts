/**
 * pnpm demo:replay [track2|track3] [--no-open] [--check]
 * Validates the replay, starts the hub (and the web host when it has a real dev script), then opens
 * /squad/village?replay=<name>. Stays in the foreground; Ctrl+C stops what it started.
 * --check: validate + hub health only, exit code for CI and preflight.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { validateReplay } from '@squad/core';
import { loadEnv } from './lib/env';
import { fetchHealth, waitForHealth } from './lib/http';
import { inspectScript, portFromScript, portFromUrl, villageUrl } from './lib/launch';
import { hubBaseUrl, ROOT } from './lib/paths';
import { readReplayJson, replayFile } from './lib/replays';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const name = args.find((a) => !a.startsWith('--')) ?? 'track2';
const { env } = loadEnv();
const children: ChildProcess[] = [];
let stopping = false;

function die(msg: string, code = 1): never {
  console.error(msg);
  stopAll();
  process.exit(code);
}

function stopAll(): void {
  stopping = true;
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
}

function start(
  label: string,
  cmd: string,
  cmdArgs: string[],
  extraEnv: Record<string, string>,
): ChildProcess {
  const child = spawn(cmd, cmdArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pipe = (s: NodeJS.ReadableStream, out: NodeJS.WriteStream) =>
    s.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n'))
        if (line.trim()) out.write(`[${label}] ${line}\n`);
    });
  pipe(child.stdout!, process.stdout);
  pipe(child.stderr!, process.stderr);
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`[${label}] exited with code ${code}; stopping the demo`);
      stopAll();
      process.exit(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

async function main(): Promise<void> {
  if (!/^[a-z0-9_-]+$/.test(name))
    die(`replay name "${name}" must match [a-z0-9_-]+ (try track2 or track3)`);

  // 1. Fail fast on an invalid replay.
  const f = readReplayJson(name, env);
  if (f.json === undefined) {
    die(
      `cannot load replay "${name}": ${f.error}\n${f.missing ? 'The demo lead commits apps/hub/sim/replays/*.json; run git pull --rebase.' : ''}`,
    );
  }
  const v = validateReplay(f.json);
  if (!v.ok)
    die(`replay "${name}" is invalid (${replayFile(name, env)}):\n  ${v.errors.join('\n  ')}`);
  console.log(`replay ${name}: valid, ${v.script.events.length} events, me=${v.script.cast.me}`);

  const webDev = inspectScript('apps/web-host', 'dev');
  const webBase = (
    env.WEB_HOST_URL || `http://localhost:${portFromScript(webDev.script) ?? 5173}`
  ).replace(/\/+$/, '');

  // 2. Hub.
  const hub = hubBaseUrl(env);
  let health = await fetchHealth(hub);
  if (health.ok) {
    console.log(`hub already healthy at ${hub}`);
  } else if (flags.has('--check')) {
    die(
      `hub not healthy at ${hub}: ${health.error ?? 'no response'}\nStart it with: pnpm --filter @squad/hub start`,
    );
  } else {
    const hubScript = inspectScript('apps/hub', 'start');
    if (hubScript.stub) {
      die(
        'The hub package has no real `start` script yet (apps/hub/package.json).\n' +
          'Merge ws/hub into your branch (git merge origin/ws/hub), or start a hub yourself and set HUB_BASE_URL.',
      );
    }
    const port = portFromUrl(hub);
    console.log(
      `starting hub: pnpm --filter @squad/hub start (HUB_SEED=1, waiting up to 30s for ${hub}/health)`,
    );
    start('hub', 'pnpm', ['--filter', '@squad/hub', 'start'], {
      HUB_SEED: '1',
      HUB_SIM: '1',
      // the browser at the web host origin must be allowed to call the hub
      HUB_CORS_ORIGINS:
        env.HUB_CORS_ORIGINS || `${webBase},http://localhost:5173,http://localhost:4173`,
      ...(port ? { HUB_PORT: String(port) } : {}),
    });
    health = await waitForHealth(hub, {
      totalMs: 30_000,
      aborted: () => stopping,
      onTick: (ms) => {
        if (ms > 0 && Math.round(ms / 500) % 6 === 0)
          console.log(`  still waiting for the hub (${Math.round(ms / 1000)}s)...`);
      },
    });
    if (!health.ok)
      die(
        `hub did not become healthy within 30s (${health.error ?? 'no response'}). Check the [hub] output above.`,
      );
    console.log('hub healthy');
  }
  if (flags.has('--check')) {
    console.log('check ok: replay valid and hub healthy');
    return;
  }

  // 3. Web host (only when it has a real dev script).
  const url = villageUrl(webBase, name);
  if (webDev.stub) {
    console.log(
      `web host has no real dev script on this branch; serve it yourself (expected at ${webBase}).`,
    );
  } else if ((await fetchHealthLike(webBase)) === true) {
    console.log(`web host already up at ${webBase}`);
  } else {
    console.log('starting web host: pnpm --filter @squad/web-host dev');
    start('web', 'pnpm', ['--filter', '@squad/web-host', 'dev'], {
      HUB_BASE_URL: hub,
      VITE_HUB_URL: hub,
      VITE_HUB_BASE_URL: hub,
    });
    const up = await waitForUrl(webBase, 30_000);
    if (!up)
      console.log(
        `web host did not answer at ${webBase} within 30s; open the URL below once it is ready`,
      );
  }

  // 4. Open.
  console.log(`\nVillage (Replay badge shown on screen): ${url}\n`);
  if (!flags.has('--no-open') && process.platform === 'darwin')
    spawn('open', [url], { stdio: 'ignore' }).unref();

  if (children.length === 0) return;
  console.log('Running in the foreground. Ctrl+C to stop.');
  await new Promise<void>(() => {
    /* until a signal or child exit */
  });
}

async function fetchHealthLike(base: string): Promise<boolean> {
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(base: string, totalMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < totalMs && !stopping) {
    if (await fetchHealthLike(base)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n${sig}: stopping hub/web started by this script`);
    stopAll();
    setTimeout(() => process.exit(0), 300);
  });
}

main().catch((e: Error) => die(`demo:replay failed: ${e.message}`));
