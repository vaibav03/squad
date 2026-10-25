import {
  DIALOGUE_CHAR_LIMIT,
  ELEVEN_MODEL_IDS,
  TtsHttpError,
  type CharTiming,
  type DialogueInput,
  type SynthRequest,
  type SynthResult,
  type TtsEngine,
} from './types';

export const ELEVEN_BASE = 'https://api.elevenlabs.io';
/** mp3 44.1k 128k is the documented default; smaller for streaming to browsers. */
export const OUTPUT_FORMAT = 'mp3_44100_128';
export const STREAM_FORMAT = 'mp3_44100_64';

export interface ElevenLabsOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Retries on 429/5xx with Retry-After aware backoff. Default 2. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface AlignmentJson {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export function alignmentToTimings(a: AlignmentJson | undefined | null): CharTiming[] {
  if (!a) return [];
  return a.characters.map((char, i) => ({
    char,
    startMs: Math.round((a.character_start_times_seconds[i] ?? 0) * 1000),
    endMs: Math.round((a.character_end_times_seconds[i] ?? 0) * 1000),
  }));
}

/**
 * Thin ElevenLabs REST client. Paths and bodies follow the official API reference
 * (text-to-speech convert / stream / with-timestamps, text-to-dialogue, text-to-voice design+create).
 * The API key is only ever placed in the `xi-api-key` header and never logged.
 */
export class ElevenLabsEngine implements TtsEngine {
  readonly id = 'elevenlabs';
  readonly ext = 'mp3' as const;
  readonly mime = 'audio/mpeg';
  private readonly f: typeof fetch;
  private readonly base: string;
  private readonly retries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: ElevenLabsOptions) {
    this.f = o.fetch ?? fetch;
    this.base = o.baseUrl ?? ELEVEN_BASE;
    this.retries = o.retries ?? 2;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private headers(json = true): Record<string, string> {
    return { 'xi-api-key': this.o.apiKey, ...(json ? { 'content-type': 'application/json' } : {}) };
  }

  /** POST with retry on 429 (honouring Retry-After) and 5xx. */
  async post(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    accept?: string,
  ): Promise<Response> {
    let attempt = 0;
    for (;;) {
      const res = await this.f(this.base + path, {
        method: 'POST',
        headers: { ...this.headers(), ...(accept ? { accept } : {}) },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (res.ok) return res;
      const ra = Number(res.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        attempt++;
        await this.sleep(retryAfterMs ?? 500 * 2 ** attempt);
        continue;
      }
      throw new TtsHttpError(res.status, detail, retryAfterMs);
    }
  }

  private body(r: SynthRequest): Record<string, unknown> {
    return { text: r.text, model_id: ELEVEN_MODEL_IDS[r.model] };
  }

  async synth(r: SynthRequest): Promise<SynthResult> {
    const res = await this.post(
      `/v1/text-to-speech/${encodeURIComponent(r.voiceId)}?output_format=${OUTPUT_FORMAT}`,
      this.body(r),
      r.signal,
      'audio/mpeg',
    );
    return { audio: new Uint8Array(await res.arrayBuffer()) };
  }

  async synthWithTimings(r: SynthRequest): Promise<SynthResult & { timings: CharTiming[] }> {
    const res = await this.post(
      `/v1/text-to-speech/${encodeURIComponent(r.voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
      this.body(r),
      r.signal,
    );
    const j = (await res.json()) as {
      audio_base64: string;
      alignment?: AlignmentJson | null;
      normalized_alignment?: AlignmentJson | null;
    };
    return {
      audio: new Uint8Array(Buffer.from(j.audio_base64, 'base64')),
      timings: alignmentToTimings(j.alignment ?? j.normalized_alignment),
    };
  }

  async *stream(r: SynthRequest): AsyncIterable<Uint8Array> {
    const res = await this.post(
      `/v1/text-to-speech/${encodeURIComponent(r.voiceId)}/stream?output_format=${STREAM_FORMAT}`,
      this.body(r),
      r.signal,
      'audio/mpeg',
    );
    if (!res.body) {
      yield new Uint8Array(await res.arrayBuffer());
      return;
    }
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value?.length) yield value;
    }
  }

  async dialogue(inputs: DialogueInput[], signal?: AbortSignal): Promise<Uint8Array> {
    const total = inputs.reduce((s, i) => s + i.text.length, 0);
    if (total > DIALOGUE_CHAR_LIMIT)
      throw new Error(`dialogue chunk ${total} > ${DIALOGUE_CHAR_LIMIT} chars`);
    if (new Set(inputs.map((i) => i.voiceId)).size > 10)
      throw new Error('dialogue supports at most 10 voices');
    const res = await this.post(
      `/v1/text-to-dialogue?output_format=${OUTPUT_FORMAT}`,
      {
        inputs: inputs.map((i) => ({ text: i.text, voice_id: i.voiceId })),
        model_id: ELEVEN_MODEL_IDS.v3,
      },
      signal,
      'audio/mpeg',
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Voice design: returns previews (each with a generated_voice_id and base64 mp3). */
  async designVoice(
    description: string,
    sampleText?: string,
  ): Promise<{ generatedVoiceId: string; audio: Uint8Array; durationSecs?: number }[]> {
    const res = await this.post('/v1/text-to-voice/design', {
      voice_description: description,
      ...(sampleText && sampleText.length >= 100
        ? { text: sampleText }
        : { auto_generate_text: true }),
    });
    const j = (await res.json()) as {
      previews: { generated_voice_id: string; audio_base_64: string; duration_secs?: number }[];
    };
    return j.previews.map((p) => ({
      generatedVoiceId: p.generated_voice_id,
      audio: new Uint8Array(Buffer.from(p.audio_base_64, 'base64')),
      ...(p.duration_secs !== undefined ? { durationSecs: p.duration_secs } : {}),
    }));
  }

  /** Save a preview as a permanent voice; returns voiceId. */
  async saveVoice(generatedVoiceId: string, name: string, description: string): Promise<string> {
    const res = await this.post('/v1/text-to-voice', {
      voice_name: name,
      voice_description: description,
      generated_voice_id: generatedVoiceId,
    });
    return ((await res.json()) as { voice_id: string }).voice_id;
  }

  /**
   * GET /v2/voices (GET /v1/voices now sits under "Legacy" in the API reference). Paged with
   * page_size (max 100) and next_page_token; used to discover a usable stock voice for the fallback.
   */
  async listVoices(maxPages = 5): Promise<{ id: string; name: string; category?: string }[]> {
    const out: { id: string; name: string; category?: string }[] = [];
    let token: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const q = new URLSearchParams({ page_size: '100' });
      if (token) q.set('next_page_token', token);
      const res = await this.f(`${this.base}/v2/voices?${q}`, { headers: this.headers(false) });
      if (!res.ok)
        throw new TtsHttpError(res.status, (await res.text().catch(() => '')).slice(0, 300));
      const j = (await res.json()) as {
        voices: { voice_id: string; name?: string; category?: string }[];
        has_more?: boolean;
        next_page_token?: string | null;
      };
      for (const v of j.voices)
        out.push({
          id: v.voice_id,
          name: v.name ?? '',
          ...(v.category ? { category: v.category } : {}),
        });
      if (!j.has_more || !j.next_page_token) break;
      token = j.next_page_token;
    }
    return out;
  }
}
