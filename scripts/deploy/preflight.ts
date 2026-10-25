/**
 * Production readiness checklist (companion to `pnpm doctor`, which is the dev-environment check).
 * Never prints secret values and never spends provider credits (reads GET /v1/status only).
 *
 *   pnpm preflight                       # config + filesystem checks from .env / the environment
 *   pnpm preflight --hub https://squad.example.com   # also probe /health and /v1/status of a running stack
 *   pnpm preflight --image squad-hub:local           # also check ffmpeg inside the built hub image
 *   pnpm preflight --strict              # warnings fail too
 * Exit code 1 when any check fails.
 */
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../demo/lib/env';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const opt = (k: string) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : undefined);
const { env, fileExists } = loadEnv();
const get = (k: string): string | undefined => env[k] || undefined;

type Level = 'ok' | 'warn' | 'fail';
let fails = 0;
let warns = 0;
const say = (level: Level, text: string) => {
  if (level === 'fail') fails++;
  if (level === 'warn') warns++;
  console.log(`${{ ok: 'OK  ', warn: 'WARN', fail: 'FAIL' }[level]}  ${text}`);
};

// ---- secrets -------------------------------------------------------------------------------------
const secret = get('INTERNAL_EVENTS_SECRET');
if (!secret) say('fail', 'INTERNAL_EVENTS_SECRET is not set (hub falls back to "change-me")');
else if (['change-me', 'dev-internal-secret', 'secret', 'changeme'].includes(secret))
  say('fail', 'INTERNAL_EVENTS_SECRET is a default value; generate one: openssl rand -hex 32');
else if (secret.length < 24) say('warn', 'INTERNAL_EVENTS_SECRET is shorter than 24 characters');
else say('ok', 'INTERNAL_EVENTS_SECRET set and not a default');
const auth = get('HUB_AUTH_SECRET');
if (!auth)
  say('warn', 'HUB_AUTH_SECRET unset: token signing key is derived from INTERNAL_EVENTS_SECRET');
else if (auth === secret)
  say('warn', 'HUB_AUTH_SECRET equals INTERNAL_EVENTS_SECRET; use a separate value');
else say('ok', 'HUB_AUTH_SECRET set separately');

// ---- env sanity ----------------------------------------------------------------------------------
say(
  fileExists ? 'ok' : 'warn',
  fileExists ? '.env present' : 'no .env (using the process environment only)',
);
const trackedEnv = spawnSync('git', ['ls-files', '--error-unmatch', '.env'], {
  cwd: ROOT,
  stdio: 'ignore',
});
say(
  trackedEnv.status === 0 ? 'fail' : 'ok',
  trackedEnv.status === 0 ? '.env is tracked by git!' : '.env is not tracked by git',
);
const origin = get('PUBLIC_ORIGIN');
if (!origin) say('warn', 'PUBLIC_ORIGIN unset (compose defaults to http://localhost:8080)');
else if (!/^https:\/\//.test(origin) && !/localhost|127\.0\.0\.1|192\.168\.|10\./.test(origin))
  say('warn', `PUBLIC_ORIGIN ${origin} is plain http on a public name; terminate TLS in front`);
else say('ok', `PUBLIC_ORIGIN ${origin}`);
if (get('HUB_SIM') === '1' || get('HUB_SIM') === 'true')
  say('fail', 'HUB_SIM=1 exposes /__sim endpoints; unset in production');
else say('ok', 'HUB_SIM is off');
if (get('HUB_SEED') === '0') say('ok', 'HUB_SEED=0: demo roster and dev-login are locked off');
else
  say(
    'warn',
    'HUB_SEED is on: demo roster + dev-login are enabled (fine for demos, not for real users)',
  );
say(
  get('GEMINI_API_KEY') ? 'ok' : 'warn',
  get('GEMINI_API_KEY')
    ? 'GEMINI_API_KEY present (value not shown)'
    : 'GEMINI_API_KEY missing: the hub serves the demo model',
);
say(
  get('ELEVENLABS_API_KEY') ? 'ok' : 'warn',
  get('ELEVENLABS_API_KEY')
    ? 'ELEVENLABS_API_KEY present'
    : 'ELEVENLABS_API_KEY missing: no voices',
);

// ---- filesystem ----------------------------------------------------------------------------------
const dbPath = get('DB_PATH') ?? 'data/squad.db';
if (dbPath !== ':memory:') {
  const dir = path.dirname(path.resolve(ROOT, dbPath));
  try {
    accessSync(existsSync(dir) ? dir : path.dirname(dir), constants.W_OK);
    say('ok', `DB directory writable: ${dir}`);
  } catch {
    say('fail', `DB directory not writable: ${dir}`);
  }
}
const dist = path.join(ROOT, 'apps/web-host/dist');
if (existsSync(dist)) {
  const all = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = path.join(d, n);
      return statSync(p).isDirectory() ? all(p) : [p];
    });
  const files = all(dist);
  say(
    files.some((f) => f.endsWith('.map')) ? 'fail' : 'ok',
    files.some((f) => f.endsWith('.map'))
      ? 'source maps found in web dist'
      : 'no source maps in web dist',
  );
  say(
    files.some((f) => /vendor|modern.?interiors/i.test(f)) ? 'fail' : 'ok',
    'no vendor/licensed art in web dist',
  );
} else
  say(
    'warn',
    'apps/web-host/dist not built (pnpm --filter @squad/web-host build); skipped dist checks',
  );
const tracked = spawnSync('git', ['ls-files', 'assets/vendor'], {
  cwd: ROOT,
  encoding: 'utf8',
}).stdout.trim();
say(
  tracked ? 'fail' : 'ok',
  tracked ? 'assets/vendor files are tracked by git' : 'no licensed vendor art tracked in git',
);

// ---- ffmpeg --------------------------------------------------------------------------------------
const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
say(
  ff.status === 0 ? 'ok' : 'warn',
  ff.status === 0
    ? `host ffmpeg: ${ff.stdout.split('\n')[0]?.slice(0, 50)}`
    : 'ffmpeg not on host PATH (fine if you only run containers)',
);
const image = opt('--image');
if (image) {
  const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'ffmpeg', image, '-version'], {
    encoding: 'utf8',
  });
  say(
    r.status === 0 ? 'ok' : 'fail',
    r.status === 0 ? `ffmpeg present in image ${image}` : `ffmpeg missing in image ${image}`,
  );
}

// ---- ports ---------------------------------------------------------------------------------------
const inUse = (port: number) =>
  new Promise<boolean>((res) => {
    const s = net.createServer();
    s.once('error', () => res(true));
    s.once('listening', () => s.close(() => res(false)));
    s.listen(port, '127.0.0.1');
  });
for (const [name, port] of [['web', Number(get('WEB_PORT') ?? 8080)]] as const) {
  if (await inUse(port))
    say('warn', `port ${port} (${name}) is busy (fine if the stack is already up)`);
  else say('ok', `port ${port} (${name}) is free`);
}

// ---- running stack (no credits spent) ------------------------------------------------------------
const hub = (opt('--hub') ?? '').replace(/\/+$/, '');
if (hub) {
  try {
    const h = (await (await fetch(`${hub}/health`)).json()) as { ok?: boolean; seed?: boolean };
    say(h.ok ? 'ok' : 'fail', `${hub}/health ok=${h.ok}`);
    const s = (await (await fetch(`${hub}/v1/status`)).json()) as {
      llm?: string;
      tts?: string;
      ports?: string;
      reason?: string;
    };
    say(
      s.llm === 'gemini' ? 'ok' : 'warn',
      `/v1/status: llm=${s.llm} tts=${s.tts} ports=${s.ports}${s.reason ? ` reason=${s.reason}` : ''}`,
    );
    const ev = await fetch(`${hub}/internal/events`, { method: 'POST' });
    say(
      ev.status === 404 || ev.status === 401 || ev.status === 403 ? 'ok' : 'warn',
      `/internal/events from outside answers ${ev.status} (should be 404 behind the proxy)`,
    );
  } catch (e) {
    say('fail', `cannot reach ${hub}: ${(e as Error).message}`);
  }
}

console.log(`\n${fails} failure(s), ${warns} warning(s)`);
process.exit(fails > 0 || (flag('--strict') && warns > 0) ? 1 : 0);
