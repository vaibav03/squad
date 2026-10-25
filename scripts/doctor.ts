/**
 * pnpm doctor: tells you whether Squad will run on real providers or stubs, and exactly what to do next.
 * Never prints a key value. Network calls to providers happen ONLY when the key exists AND SQUAD_LIVE=1,
 * and cost one output token (Gemini) and one character (ElevenLabs).
 *
 *   pnpm doctor                 # offline report
 *   SQUAD_LIVE=1 pnpm doctor    # plus the two tiny live checks
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV_FILE, loadEnv } from './demo/lib/env';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { env, fileExists } = loadEnv();
const get = (k: string): string | undefined => env[k] || undefined;
const live = get('SQUAD_LIVE') === '1';

type Level = 'ok' | 'warn' | 'fail' | 'info';
const results: { level: Level; text: string }[] = [];
const nextSteps: string[] = [];
const say = (level: Level, text: string) => {
  results.push({ level, text });
  const tag = { ok: 'OK  ', warn: 'WARN', fail: 'FAIL', info: 'INFO' }[level];
  console.log(`${tag}  ${text}`);
};
const step = (s: string) => {
  if (!nextSteps.includes(s)) nextSteps.push(s);
};

const trim = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}...` : s);

// ---- tools -------------------------------------------------------------------------------------
function tool(cmd: string, argv: string[]): string | undefined {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  if (r.status !== 0 || r.error) return undefined;
  return (r.stdout || r.stderr).split('\n')[0]?.trim();
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
say(nodeMajor >= 20 ? 'ok' : 'fail', `node v${process.versions.node} (needs >= 20)`);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  packageManager?: string;
};
const wantPnpm = pkg.packageManager?.replace(/^pnpm@/, '');
const pnpmV = tool('pnpm', ['-v']);
if (!pnpmV) {
  say('fail', 'pnpm not found');
  step(
    'Install pnpm: corepack enable && corepack prepare pnpm@' +
      (wantPnpm ?? 'latest') +
      ' --activate',
  );
} else
  say(
    !wantPnpm || pnpmV === wantPnpm ? 'ok' : 'warn',
    `pnpm ${pnpmV}${wantPnpm && pnpmV !== wantPnpm ? ` (repo pins ${wantPnpm})` : ''}`,
  );
for (const t of ['ffmpeg', 'ffprobe']) {
  const v = tool(t, ['-version']);
  if (v) say('ok', `${t}: ${trim(v, 60)}`);
  else {
    say('fail', `${t} not found on PATH (podcast, explainer and call audio need it)`);
    step('brew install ffmpeg   (provides ffmpeg and ffprobe)');
  }
}
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  say('fail', 'node_modules missing');
  step('pnpm install');
}

// ---- env + keys (names only) ---------------------------------------------------------------------
const mainCheckoutEnv = path.resolve(ROOT, '..', '..', 'squad', '.env');
if (fileExists) say('ok', `.env found at ${path.relative(process.cwd(), ENV_FILE) || '.env'}`);
else {
  say('warn', `no .env in ${ROOT}`);
  step(
    fs.existsSync(mainCheckoutEnv)
      ? `This looks like a git worktree: cp ${mainCheckoutEnv} ${ENV_FILE}   (do not commit it)`
      : 'cp .env.example .env and add GEMINI_API_KEY / ELEVENLABS_API_KEY',
  );
}
const hasGemini = Boolean(get('GEMINI_API_KEY'));
const hasEleven = Boolean(get('ELEVENLABS_API_KEY'));
say(
  hasGemini ? 'ok' : 'warn',
  `GEMINI_API_KEY ${hasGemini ? 'present' : 'missing: everything LLM-shaped runs on FakeLlm stubs'}`,
);
say(
  hasEleven ? 'ok' : 'warn',
  `ELEVENLABS_API_KEY ${hasEleven ? 'present' : 'missing: calls are caption-only, voice previews fail, podcast/explainer skills are not registered'}`,
);
say(
  get('INTERNAL_EVENTS_SECRET') ? 'ok' : 'info',
  `INTERNAL_EVENTS_SECRET ${get('INTERNAL_EVENTS_SECRET') ? 'set' : 'not set (pnpm dev:all uses a dev default; set a random value for anything shared)'}`,
);
say(
  'info',
  `SQUAD_LIVE=${live ? '1 (live provider checks enabled)' : 'unset (provider checks skipped)'}`,
);
if (!hasGemini)
  step(
    'Add GEMINI_API_KEY to .env (https://aistudio.google.com/apikey), then SQUAD_LIVE=1 pnpm doctor',
  );
if (!hasEleven)
  step('Add ELEVENLABS_API_KEY to .env (https://elevenlabs.io/app/settings/api-keys) for voices');

// ---- ports ---------------------------------------------------------------------------------------
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => s.close(() => resolve(false)));
    s.listen(port);
  });
}
const ports: [string, number][] = [
  ['hub', 8788],
  ['web host', 5180],
  ['agent s_ana', 4101],
  ['agent s_ben', 4102],
  ['agent s_cam', 4103],
  ['agent s_dev', 4104],
];
let anyBusy = false;
for (const [name, port] of ports)
  if (await portInUse(port)) {
    anyBusy = true;
    say('info', `port ${port} (${name}) is in use`);
  } else say('ok', `port ${port} (${name}) is free`);
if (anyBusy)
  step(
    'Ports in use are fine if the stack is already running; otherwise find the holder: lsof -nP -iTCP:<port> -sTCP:LISTEN',
  );

// ---- running hub status --------------------------------------------------------------------------
const hubUrl = (get('HUB_BASE_URL') || 'http://localhost:8788').replace(/\/+$/, '');
try {
  const res = await fetch(`${hubUrl}/v1/status`, { signal: AbortSignal.timeout(1500) });
  if (res.ok)
    say('info', `hub ${hubUrl}/v1/status: ${trim(JSON.stringify(await res.json()), 400)}`);
  else if (res.status === 404)
    say('warn', `hub at ${hubUrl} is up but has no /v1/status (older build)`);
} catch {
  say('info', `hub not reachable at ${hubUrl} (start it with pnpm dev:all)`);
}

// ---- live provider checks (opt in) ---------------------------------------------------------------
type Class = 'ok' | 'credits_depleted' | 'rate_limited' | 'auth' | 'bad_request' | 'other';
function classify(status: number, body: string): Class {
  if (status >= 200 && status < 300) return 'ok';
  const b = body.toLowerCase();
  if (status === 402 || (b.includes('resource_exhausted') && /prepay|credit|billing/.test(b)))
    return 'credits_depleted';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403 || b.includes('api_key_invalid')) return 'auth';
  if (status === 400) return 'bad_request';
  return 'other';
}

if (live && hasGemini) {
  const model = get('GEMINI_MODEL_FAST') || 'gemini-3.5-flash-lite';
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with one word: ok' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = await res.text();
    const c = classify(res.status, body);
    if (c === 'ok') say('ok', `Gemini ${model}: generateContent works (HTTP ${res.status})`);
    else {
      say('fail', `Gemini ${model}: HTTP ${res.status} ${c}: ${trim(body.replace(/\s+/g, ' '))}`);
      if (c === 'credits_depleted') {
        say(
          'warn',
          'The app automatically falls back to FakeLlm demo mode (GET /v1/status shows {llm:"fake", reason:"credits_depleted"}).',
        );
        step(
          "Gemini credits are depleted (HTTP 402 RESOURCE_EXHAUSTED). Top up AI Studio prepay billing: https://ai.studio/projects  (open the key's project there, then Billing; docs: https://ai.google.dev/gemini-api/docs/billing), then rerun SQUAD_LIVE=1 pnpm doctor.",
        );
      } else if (c === 'rate_limited')
        step(
          "Gemini is rate limiting (429). Wait a minute, or raise the quota on the key's project, then rerun.",
        );
      else if (c === 'auth')
        step(
          'Gemini rejected the key (401/403). Create a fresh key at https://aistudio.google.com/apikey and update GEMINI_API_KEY in .env.',
        );
      else if (c === 'bad_request')
        step(
          `Gemini rejected the request (400): check the model id ${model} (GEMINI_MODEL_FAST) against https://ai.google.dev/gemini-api/docs/models`,
        );
    }
  } catch (e) {
    say(
      'fail',
      `Gemini check could not reach the API: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
} else if (hasGemini)
  say('info', 'Gemini live check skipped (set SQUAD_LIVE=1 to spend one output token)');

if (live && hasEleven) {
  // Premade voice "Rachel"; the 1-character request uses the cheapest model and the smallest output format.
  const voice = get('ELEVENLABS_DOCTOR_VOICE_ID') || '21m00Tcm4TlvDq8ikWAM';
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_22050_32`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': get('ELEVENLABS_API_KEY')! },
        body: JSON.stringify({ text: 'a', model_id: 'eleven_flash_v2_5' }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (res.ok) {
      const n = (await res.arrayBuffer()).byteLength;
      say('ok', `ElevenLabs text-to-speech works (HTTP ${res.status}, ${n} bytes for 1 character)`);
    } else {
      const body = await res.text();
      say('fail', `ElevenLabs HTTP ${res.status}: ${trim(body.replace(/\s+/g, ' '))}`);
      if (res.status === 401)
        step(
          'ElevenLabs rejected the key: regenerate it at https://elevenlabs.io/app/settings/api-keys and update ELEVENLABS_API_KEY.',
        );
      else if (res.status === 402 || /quota/i.test(body))
        step('ElevenLabs quota/credits exhausted: https://elevenlabs.io/app/subscription');
      else if (res.status === 404)
        step(
          `ElevenLabs voice ${voice} not found for this account: set ELEVENLABS_DOCTOR_VOICE_ID to a voice from GET /v1/voices.`,
        );
    }
  } catch (e) {
    say(
      'fail',
      `ElevenLabs check could not reach the API: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
} else if (hasEleven)
  say('info', 'ElevenLabs live check skipped (set SQUAD_LIVE=1 to spend one character)');

// ---- verdict -------------------------------------------------------------------------------------
const failed = results.some((r) => r.level === 'fail');
const realLlm = hasGemini && !results.some((r) => r.level === 'fail' && /Gemini/.test(r.text));
console.log('\nmode');
console.log(
  `  LLM    ${realLlm ? (live ? 'REAL (verified)' : 'REAL (key present, not verified: SQUAD_LIVE=1 pnpm doctor)') : 'STUB (FakeLlm)'}`,
);
console.log(
  `  voice  ${hasEleven && !results.some((r) => r.level === 'fail' && /ElevenLabs/.test(r.text)) ? 'REAL' : 'caption-only (no TTS)'}`,
);
if (nextSteps.length) {
  console.log('\nnext steps');
  nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
console.log(
  '\nrun everything: pnpm dev:all   |   offline end-to-end check: pnpm demo:live   |   rehearsal check: pnpm demo:preflight',
);
process.exit(failed ? 1 : 0);
