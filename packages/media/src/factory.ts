import { join } from 'node:path';
import { findRepoRoot, loadConfig, type Config } from '@squad/core/node';
import { createCallPort, type CallPortOptions } from './call/port';
import type { CallPort } from './call/types';
import { createMediaPort, type MediaPort } from './call/media-port';
import { GeminiTranscriber, type Transcriber } from './call/transcribe';
import { budgetFromEnv, type BudgetGuard } from './tts/budget';
import { ElevenLabsEngine } from './tts/elevenlabs';
import { TtsHealth, sharedTtsHealth } from './tts/health';
import { TtsService } from './tts/service';
import type { TtsEngine } from './tts/types';
import { DEFAULT_FALLBACK_VOICE_ID, VoiceService } from './voices/service';
import { JsonVoiceStore, type VoiceStore } from './voices/store';

export interface AudioServices {
  tts: TtsService;
  voices: VoiceService;
  store: VoiceStore;
  budget: BudgetGuard;
  engine: TtsEngine;
  eleven?: ElevenLabsEngine;
  /** Truthful speech status; absent when an engine was injected (tests, demos). */
  health?: TtsHealth;
  cacheDir: string;
  /** Hub wiring helpers (apps/hub/src/index.ts swaps these in for the stubs). */
  mediaPort(personas: MediaPortPersonas): MediaPort;
  callPort(o: Pick<CallPortOptions, 'answer'> & Partial<CallPortOptions>): CallPort;
}
type MediaPortPersonas = Parameters<typeof createMediaPort>[0]['personas'];

export interface AudioOptions {
  config?: Config;
  engine?: TtsEngine; // inject FakeTts for tests/demos
  fallbackEngine?: TtsEngine;
  root?: string;
  budget?: BudgetGuard;
  store?: VoiceStore;
  /** Override the probe (tests); by default one shared probe per API key. */
  health?: TtsHealth;
}

/**
 * The shared speech probe for this key: saved voices, then voice design, then the account's listed voices,
 * then the stock voice, each tried with one character. Retries are off so a probe fails fast and cheap.
 */
export function ttsHealthFromConfig(apiKey: string, store?: VoiceStore): TtsHealth {
  return sharedTtsHealth(apiKey, () => {
    const st =
      store ??
      new JsonVoiceStore(
        join(findRepoRoot(), 'packages', 'media', 'src', 'voices', 'saved-voices.json'),
      );
    return new TtsHealth({
      engine: new ElevenLabsEngine({ apiKey, retries: 0 }),
      store: st,
      ownVoiceIds: [
        process.env.ELEVENLABS_VOICE_ID,
        process.env.ELEVENLABS_FALLBACK_VOICE_ID,
      ].filter((v): v is string => !!v),
      stockVoiceId: DEFAULT_FALLBACK_VOICE_ID,
    });
  });
}

/** Builds the audio stack from env (ELEVENLABS_API_KEY, ELEVENLABS_FALLBACK_VOICE_ID, SQUAD_BUDGET_*). Throws if no engine can be made. */
export function createAudioServices(o: AudioOptions = {}): AudioServices {
  const cfg = o.config ?? loadConfig();
  const root = o.root ?? findRepoRoot();
  const cacheDir = join(root, 'cache', 'audio');
  const eleven =
    !o.engine && cfg.elevenLabsApiKey
      ? new ElevenLabsEngine({ apiKey: cfg.elevenLabsApiKey })
      : undefined;
  const engine = o.engine ?? eleven;
  if (!engine) throw new Error('ELEVENLABS_API_KEY is not set (or pass an engine, e.g. FakeTts)');
  const budget = o.budget ?? budgetFromEnv();
  const store =
    o.store ??
    new JsonVoiceStore(join(root, 'packages', 'media', 'src', 'voices', 'saved-voices.json'));
  const fallbackVoiceId = process.env.ELEVENLABS_FALLBACK_VOICE_ID || DEFAULT_FALLBACK_VOICE_ID;
  const health =
    o.health ??
    (eleven && cfg.elevenLabsApiKey ? ttsHealthFromConfig(cfg.elevenLabsApiKey, store) : undefined);
  const voices = new VoiceService({
    store,
    fallbackVoiceId,
    ...(health ? { provenVoice: () => health.voiceId() } : {}),
    ...(eleven ? { engine: eleven } : {}),
    budget,
    previewDir: join(cacheDir, 'voice-previews'),
  });
  const tts = new TtsService({
    engine,
    voices,
    cacheDir: join(cacheDir, 'tts'),
    budget,
    ...(health ? { gate: () => health.gate() } : {}),
    ...(o.fallbackEngine ? { fallbackEngine: o.fallbackEngine } : {}),
    fallbackVoiceId,
    concurrency:
      Number(process.env.SQUAD_TTS_CONCURRENCY) > 0
        ? Math.floor(Number(process.env.SQUAD_TTS_CONCURRENCY))
        : 3,
  });
  return {
    tts,
    voices,
    store,
    budget,
    engine,
    ...(eleven ? { eleven } : {}),
    ...(health ? { health } : {}),
    cacheDir,
    mediaPort: (personas) => createMediaPort({ personas, tts, store }),
    callPort: (c) => {
      const transcriber: Transcriber | undefined = cfg.geminiApiKey
        ? new GeminiTranscriber({ apiKey: cfg.geminiApiKey, budget })
        : undefined;
      return createCallPort({
        tts,
        budget,
        ...(transcriber ? { transcriber } : {}),
        ...c,
      });
    },
  };
}
