/**
 * pnpm security:scan  -  secret scan, dependency audit, ignore-file checks, config checks and the
 * attack probes against a hub booted in-process on a free port (HUB_SEED/HUB_SIM semantics).
 * Exit code 1 when any critical/high/medium finding exists; `low` and `warn` items are printed only.
 *
 *   pnpm security:scan                 # everything
 *   pnpm security:scan -- --no-audit   # skip `pnpm audit` (offline)
 *   pnpm security:scan -- --no-history # skip git history scan
 *   HUB_URL=https://... SECRET=... pnpm security:scan -- --remote   # header/auth probes only (needs tokens via TOKEN_ANA)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHub } from '../../apps/hub/src/server';
import { checkConfig } from '../../apps/hub/src/security/config-guard';
import { runProbes, type Finding } from './probes';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = new Set(process.argv.slice(2));
const findings: Finding[] = [];
const add = (id: string, severity: Finding['severity'], detail: string) =>
  findings.push({ id, severity, detail });
const sh = (cmd: string, a: string[], max = 512 * 1024 * 1024) =>
  spawnSync(cmd, a, { cwd: root, encoding: 'utf8', maxBuffer: max });

// ---- 1. secrets (tree + history). Values are never printed: only file/commit and the key class. ----
const PATTERNS: [string, RegExp][] = [
  ['Google API key (AIza)', /AIza[0-9A-Za-z_-]{35}/],
  ['Google OAuth/AQ key', /\bAQ\.[A-Za-z0-9_-]{20,}/],
  ['OpenAI/Anthropic style key (sk-)', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['ElevenLabs key (xi-)', /\bxi-[A-Za-z0-9]{20,}/],
  ['Stripe key', /\bsk_(live|test)_[A-Za-z0-9]{16,}/],
  ['GitHub token', /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const ALLOW_FILE = /(^|\/)(\.env\.example|pnpm-lock\.yaml|scan\.ts)$/;

function scanText(where: string, text: string, sev: Finding['severity']) {
  for (const [name, re] of PATTERNS)
    if (re.test(text)) add('SECRET-1', sev, `${name} pattern in ${where}`);
}
{
  const files = sh('git', ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  for (const f of files) {
    if (
      ALLOW_FILE.test(f) ||
      /\.(png|jpg|jpeg|gif|webp|pdf|ico|woff2?|ttf|mp3|wav|ogg|zip|glb|json\.gz)$/i.test(f)
    )
      continue;
    const p = resolve(root, f);
    if (!existsSync(p)) continue;
    let t = '';
    try {
      t = readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    if (t.length > 5_000_000) continue;
    scanText(f, t, 'critical');
  }
  const bad = files.filter(
    (f) =>
      /(^|\/)(\.env(\.(?!example$).*)?|.*\.pem|.*\.p12|id_rsa|.*\.sqlite3?|.*\.db|.*\.map)$/.test(
        f,
      ) || /^vendor-local\//.test(f),
  );
  for (const f of bad) add('SECRET-2', 'high', `file that must not be tracked: ${f}`);
  if (!args.has('--no-history')) {
    const src = PATTERNS.map(([, r]) => r.source).join('|');
    const log = sh('git', [
      'log',
      '--all',
      '-p',
      '--no-color',
      '--text',
      '-G',
      src,
      '--format=@@%h',
    ]);
    let sha = '';
    const seen = new Set<string>();
    for (const line of (log.stdout ?? '').split('\n')) {
      if (line.startsWith('@@')) sha = line.slice(2);
      else if (line.startsWith('+') && !line.startsWith('+++'))
        for (const [name, re] of PATTERNS)
          if (re.test(line) && !seen.has(`${sha}${name}`)) {
            seen.add(`${sha}${name}`);
            add(
              'SECRET-3',
              'critical',
              `${name} pattern added in commit ${sha} (rotate it; history rewrite needed)`,
            );
          }
    }
  }
}

// ---- 2. gitignore ----
{
  const gi = readFileSync(resolve(root, '.gitignore'), 'utf8');
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(gi))
    add('IGNORE-1', 'medium', '.gitignore contains merge conflict markers');
  for (const p of [
    '.env',
    '.env.local',
    'vendor-local/x',
    'assets/vendor/x',
    'data/squad.db',
    'x.db',
    'dist/a.js.map',
    'k.pem',
  ]) {
    const r = sh('git', ['check-ignore', '-q', p]);
    if (r.status !== 0) add('IGNORE-2', 'medium', `${p} is not git-ignored`);
  }
}

// ---- 3. dependency audit ----
if (!args.has('--no-audit')) {
  const a = sh('pnpm', ['audit', '--prod', '--audit-level', 'moderate', '--json']);
  try {
    const j = JSON.parse(a.stdout || '{}') as {
      metadata?: { vulnerabilities?: Record<string, number> };
    };
    const v = j.metadata?.vulnerabilities ?? {};
    if ((v.critical ?? 0) + (v.high ?? 0) > 0)
      add('DEP-1', 'high', `pnpm audit --prod: ${v.critical ?? 0} critical, ${v.high ?? 0} high`);
    else if ((v.moderate ?? 0) > 0)
      add('DEP-2', 'medium', `pnpm audit --prod: ${v.moderate} moderate`);
  } catch {
    add('DEP-0', 'low', 'pnpm audit unavailable (offline?); run with network');
  }
  const all = sh('pnpm', ['audit', '--audit-level', 'high', '--json']);
  try {
    const v =
      (
        JSON.parse(all.stdout || '{}') as {
          metadata?: { vulnerabilities?: Record<string, number> };
        }
      ).metadata?.vulnerabilities ?? {};
    if ((v.critical ?? 0) + (v.high ?? 0) > 0)
      add(
        'DEP-3',
        'low',
        `pnpm audit (dev deps): ${v.critical ?? 0} critical, ${v.high ?? 0} high (CI/dev machines only)`,
      );
  } catch {
    /* ignore */
  }
}

// ---- 4. config guard: what a production boot would refuse ----
{
  const prodLike = {
    port: 0,
    baseUrl: 'http://localhost:8788',
    internalSecret: process.env.INTERNAL_EVENTS_SECRET || 'change-me',
    authSecret: process.env.HUB_AUTH_SECRET || 'auth:change-me',
    corsOrigins: ['http://localhost:5173'],
    dbPath: ':memory:',
    replayDir: '',
    seed: false,
    sim: false,
    production: true,
    logLevel: 'silent' as const,
    sse: { bufferSize: 1, maxQueue: 1, pingMs: 1 },
  };
  for (const p of checkConfig(prodLike).filter((x) => x.level === 'fatal'))
    if (process.env.NODE_ENV === 'production') add('CFG-1', 'critical', `${p.code}: ${p.message}`);
}

// ---- 5. probes against a booted hub ----
if (!args.has('--no-probes')) {
  const secret = 'scan-' + Math.random().toString(36).slice(2) + 'x'.repeat(16);
  const hub = await startHub({
    config: {
      port: 0,
      internalSecret: secret,
      authSecret: 'scan-auth-' + secret,
      seed: true,
      sim: true,
      production: false,
      logLevel: 'silent',
      replayDir: resolve(root, 'apps/hub/sim/replays'),
    },
    security: { configCheck: 'skip' },
  });
  try {
    hub.deps.directory.upsertStudent({ id: 's_zed', name: 'Zed', handle: 'zed@demo.test' });
    hub.deps.directory.upsertSquad({ id: 'sq_other', name: 'Other', members: ['s_zed'] });
    const login = async (id: string) =>
      (
        (await (
          await fetch(`${hub.url}/v1/auth/dev-login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ studentId: id }),
          })
        ).json()) as { token: string }
      ).token;
    const tokens = {
      ana: await login('s_ana'),
      ben: await login('s_ben'),
      zed: await login('s_zed'),
    };
    const trip = hub.deps.trips.list('sq_demo')[0] ?? hub.deps.trips.list()[0];
    findings.push(
      ...(await runProbes({
        url: hub.url,
        secret,
        tokens,
        taskA: trip?.taskId ?? 'task_trip_cabo',
        tripA: trip?.tripId ?? 'trip_cabo',
      })),
    );
  } finally {
    await hub.stop();
  }
}

// ---- report ----
const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
findings.sort((a, b) => order[a.severity] - order[b.severity]);
for (const x of findings) console.log(`[${x.severity.toUpperCase()}] ${x.id} ${x.detail}`);
const blocking = findings.filter((x) => x.severity !== 'low');
console.log(`\nsecurity:scan  ${findings.length} finding(s), ${blocking.length} blocking`);
process.exit(blocking.length ? 1 : 0);
