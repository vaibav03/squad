/**
 * pnpm doctor: tells you whether Squad will run on real providers or stubs, and exactly what to do next.
 * Never prints a key value. Network calls to providers happen only when the key exists (SQUAD_LIVE=0 skips them)
 * and cost one output token (Gemini) and at most a few characters (ElevenLabs: one per candidate voice).
 *
 *   pnpm doctor                 # reports what really works, what fails and the exact fix
 *   SQUAD_LIVE=0 pnpm doctor    # offline: no provider calls
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENV_FILE, loadEnv } from './demo/lib/env';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { env, fileExists } = loadEnv();
const get = (k: string): string | undefined => env[k] || undefined;
// Live checks are on by default so the report matches what the hub's startup probe sees (SQUAD_LIVE=0 skips them).
const live = get('SQUAD_LIVE') !== '0';

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
say('info', `live checks ${live ? 'on (provider checks enabled)' : '0 (provider checks skipped)'}`);
if (!hasGemini)
  step('Add GEMINI_API_KEY to .env (https://aistudio.google.com/apikey), then pnpm doctor');
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
          'The app serves FakeLlm demo answers meanwhile, re-probes Gemini once per 60 s and switches back by itself when credits return (GET /v1/status shows llm, reason, lastProbeAt, nextProbeAt). No restart needed after topping up.',
        );
        step(
          "Gemini credits are depleted (HTTP 402 RESOURCE_EXHAUSTED). Top up AI Studio prepay billing: https://ai.studio/projects  (open the key's project there, then Billing; docs: https://ai.google.dev/gemini-api/docs/billing), then rerun pnpm doctor.",
        );
      } else if (c === 'rate_limited')
        step(
          "Gemini is rate limiting (429). Wait a minute, or raise the quota on the key's project, then rerun.",
        );
      else if (c === 'auth')
        step(
          'Gemini rejected the key (401/403, status reason invalid_key). The running app keeps serving the fake and re-probes every 10 minutes, but only with the key it started with, so after fixing the key restart it. Create a fresh key at https://aistudio.google.com/apikey and update GEMINI_API_KEY in .env.',
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
} else if (hasGemini) say('info', 'Gemini live check skipped (SQUAD_LIVE=0)');

if (live && hasEleven) {
  // The same probe the hub runs at startup (packages/media/src/tts/health.ts): saved voice ids, then the
  // account's listed voices, then the stock voice, one character each. Voice design is off here (read-only).
  // Loaded by file path: the root has no workspace links, and the doctor must run even before a build.
  type Health = {
    start(): Promise<{ tts: string; reason: string }>;
    voiceId(): string | undefined;
  };
  type Media = {
    TtsHealth: new (o: Record<string, unknown>) => Health;
    ElevenLabsEngine: new (o: { apiKey: string; retries: number }) => unknown;
    JsonVoiceStore: new (file: string) => unknown;
    DEFAULT_FALLBACK_VOICE_ID: string;
  };
  const load = <T>(rel: string): Promise<T> =>
    import(pathToFileURL(path.join(ROOT, rel)).href) as Promise<T>;
  const { TtsHealth, ElevenLabsEngine, JsonVoiceStore, DEFAULT_FALLBACK_VOICE_ID } =
    await load<Media>('packages/media/src/index.ts');
  const { TTS_NOTICES } = await load<{ TTS_NOTICES: Record<string, string> }>(
    'packages/core/src/index.ts',
  );
  const voicesFile = path.join(ROOT, 'packages', 'media', 'src', 'voices', 'saved-voices.json');
  const health = new TtsHealth({
    engine: new ElevenLabsEngine({ apiKey: get('ELEVENLABS_API_KEY')!, retries: 0 }),
    store: new JsonVoiceStore(voicesFile),
    allowDesign: false,
    ownVoiceIds: [get('ELEVENLABS_VOICE_ID'), get('ELEVENLABS_FALLBACK_VOICE_ID')].filter(
      (v): v is string => !!v,
    ),
    stockVoiceId: DEFAULT_FALLBACK_VOICE_ID,
  });
  const st = await health.start();
  if (st.tts === 'elevenlabs') {
    say(
      'ok',
      `ElevenLabs text-to-speech works (voice ${health.voiceId()}, 1 character per candidate)`,
    );
  } else {
    say(
      'fail',
      `ElevenLabs cannot speak: reason ${st.reason}. Calls, podcast and previews show: ${TTS_NOTICES[st.reason]}`,
    );
    if (st.reason === 'paid_plan_required')
      step(
        'ElevenLabs free plans cannot use library voices through the API (HTTP 402 paid_plan_required). Either upgrade at https://elevenlabs.io/app/subscription, or put a voice you own in packages/media/src/voices/saved-voices.json / ELEVENLABS_VOICE_ID, or create a key with the text_to_speech, voices_read and voices_write permissions (https://elevenlabs.io/app/settings/api-keys) so the hub can list or design a voice on its own.',
      );
    else if (st.reason === 'key_restricted')
      step(
        'ElevenLabs rejected the key or it lacks text_to_speech. Create a key with the text_to_speech and voices_read permissions (add voices_write to let the hub design a voice) at https://elevenlabs.io/app/settings/api-keys and update ELEVENLABS_API_KEY.',
      );
    else if (st.reason === 'rate_limited')
      step('ElevenLabs is rate limiting or out of quota: https://elevenlabs.io/app/subscription');
    else step('ElevenLabs could not be reached or the voice ids were refused: rerun in a minute.');
  }
} else if (hasEleven) say('info', 'ElevenLabs live check skipped (SQUAD_LIVE=0)');

// ---- verdict -------------------------------------------------------------------------------------
const failed = results.some((r) => r.level === 'fail');
const llmOk =
  hasGemini && live && results.some((r) => r.level === 'ok' && /Gemini .*works/.test(r.text));
const voiceOk =
  hasEleven &&
  live &&
  results.some((r) => r.level === 'ok' && /ElevenLabs text-to-speech works/.test(r.text));
console.log(
  `  LLM    ${llmOk ? 'REAL (verified)' : !hasGemini ? 'STUB (FakeLlm, no key)' : live ? 'STUB (FakeLlm: Gemini failed, see above)' : 'unverified (live checks off)'}`,
);
console.log(
  `  voice  ${voiceOk ? 'REAL (verified)' : !hasEleven ? 'caption-only (no key)' : live ? 'caption-only (ElevenLabs cannot speak, see above)' : 'unverified (live checks off)'}`,
);
if (nextSteps.length) {
  console.log('\nnext steps');
  nextSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
console.log(
  '\nrun everything: pnpm dev:all   |   offline end-to-end check: pnpm demo:live   |   rehearsal check: pnpm demo:preflight',
);
process.exit(failed ? 1 : 0);
