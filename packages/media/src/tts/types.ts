/** Shared audio types. Pure types plus tiny helpers; no I/O. */

export interface CharTiming {
  char: string;
  startMs: number;
  endMs: number;
}

export type TtsModel = 'flash' | 'v3';

/** Concrete ElevenLabs model ids (verified against elevenlabs.io/docs/overview/models, see docs/audio-api.md). */
export const ELEVEN_MODEL_IDS: Record<TtsModel, string> = {
  flash: 'eleven_flash_v2_5',
  v3: 'eleven_v3',
};

/** Hard per-request character limits from the same page (flash 40k, v3 5k); dialogue is 2,000 total. */
export const DIALOGUE_CHAR_LIMIT = 2000;
/** Podcast chunks stay under the dialogue limit with headroom. */
export const PODCAST_CHUNK_CHARS = 1800;

export interface SynthRequest {
  voiceId: string;
  text: string;
  model: TtsModel;
  /** Optional per-voice style instruction (used by engines that support it). */
  style?: string;
  signal?: AbortSignal;
}

export interface SynthResult {
  audio: Uint8Array;
  timings?: CharTiming[];
}

export interface DialogueInput {
  voiceId: string;
  text: string;
}

/** One speech backend (ElevenLabs, fake, OS fallback). All methods must be side-effect free besides network. */
export interface TtsEngine {
  /** Stable id folded into cache keys, e.g. `elevenlabs`. */
  readonly id: string;
  /** File extension and mime of the audio this engine returns. */
  readonly ext: 'mp3' | 'wav';
  readonly mime: string;
  synth(req: SynthRequest): Promise<SynthResult>;
  synthWithTimings(req: SynthRequest): Promise<SynthResult & { timings: CharTiming[] }>;
  stream(req: SynthRequest): AsyncIterable<Uint8Array>;
  /** Multi-voice render of up to DIALOGUE_CHAR_LIMIT chars. Engines without a native endpoint omit it. */
  dialogue?(inputs: DialogueInput[], signal?: AbortSignal): Promise<Uint8Array>;
}

export interface SpeakResult {
  path: string;
  durationMs: number;
  mime: string;
  timings?: CharTiming[];
  /** True when served from the disk cache (no engine call, no budget spend). */
  cached: boolean;
  /** Which engine produced it. `fallback` means the primary was unavailable. */
  source: 'primary' | 'fallback';
}

export class BudgetExceededError extends Error {
  constructor(
    readonly meter: string,
    readonly limit: number,
    readonly window: 'hour' | 'total',
  ) {
    super(`budget exceeded for ${meter} (${window} limit ${limit})`);
    this.name = 'BudgetExceededError';
  }
}

export class TtsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly retryAfterMs?: number,
  ) {
    super(`ElevenLabs HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.name = 'TtsHttpError';
  }
}
