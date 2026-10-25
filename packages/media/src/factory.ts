import { join } from 'node:path';
import { findRepoRoot, loadConfig, type Config } from '@squad/core/node';
import { createCallPort, type CallPortOptions } from './call/port';
import type { CallPort } from './call/types';
import { createMediaPort, type MediaPort } from './call/media-port';
import { GeminiTranscriber, type Transcriber } from './call/transcribe';
import { budgetFromEnv, type BudgetGuard } from './tts/budget';
import { ElevenLabsEngine } from './tts/elevenlabs';
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
  const voices = new VoiceService({
    store,
    fallbackVoiceId,
    ...(eleven ? { engine: eleven } : {}),
    budget,
    previewDir: join(cacheDir, 'voice-previews'),
  });
  const tts = new TtsService({
    engine,
    voices,
    cacheDir: join(cacheDir, 'tts'),
    budget,
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
