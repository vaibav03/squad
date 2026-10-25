import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { VoiceService } from '../voices/service';
import { probeDurationMs, readJsonIfExists, writeFileEnsured } from './audio';
import type { BudgetGuard } from './budget';
import { Limiter } from './limiter';
import {
  BudgetExceededError,
  TtsHttpError,
  type CharTiming,
  type SpeakResult,
  type TtsEngine,
  type TtsModel,
} from './types';

export interface TtsServiceOptions {
  engine: TtsEngine;
  voices: Pick<VoiceService, 'resolve'>;
  cacheDir: string;
  budget?: BudgetGuard;
  /** Used when the primary throws or the budget is out. Optional. */
  fallbackEngine?: TtsEngine;
  /** Concurrent engine requests. ElevenLabs plans cap concurrency (Creator 10, Free 2-3; verify on your plan). Default 3. */
  concurrency?: number;
  /** Stock voice for the fallback engine when the persona has none usable there. */
  fallbackVoiceId?: string;
  /** Called before any paid engine call (after cache lookups); throws `VoicesUnavailableError` to degrade honestly. */
  gate?: () => Promise<void>;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface SpeakOptions {
  timings?: boolean;
  model?: TtsModel;
  signal?: AbortSignal;
}

interface Sidecar {
  durationMs: number;
  timings?: CharTiming[];
}

/** Cache key = hash(engine, model, voiceId, text). Same input always maps to the same file. */
export function cacheKey(engineId: string, model: TtsModel, voiceId: string, text: string): string {
  return createHash('sha256')
    .update(JSON.stringify([engineId, model, voiceId, text]))
    .digest('hex')
    .slice(0, 32);
}

export class TtsService {
  private readonly limiter: Limiter;
  private readonly inflight = new Map<string, Promise<SpeakResult>>();
  constructor(private readonly o: TtsServiceOptions) {
    this.limiter = new Limiter(o.concurrency ?? 3);
  }

  private log(msg: string, ctx?: Record<string, unknown>) {
    this.o.log?.(msg, ctx); // never include keys; text is only logged by length
  }

  private paths(engine: TtsEngine, key: string) {
    const base = join(this.o.cacheDir, key.slice(0, 2), key);
    return { audio: `${base}.${engine.ext}`, meta: `${base}.json` };
  }

  private async lookup(
    engine: TtsEngine,
    key: string,
    wantTimings: boolean,
  ): Promise<SpeakResult | undefined> {
    const p = this.paths(engine, key);
    try {
      await access(p.audio);
    } catch {
      return undefined;
    }
    const side = await readJsonIfExists<Sidecar>(p.meta);
    if (!side) return undefined;
    if (wantTimings && !side.timings) return undefined;
    return {
      path: p.audio,
      durationMs: side.durationMs,
      mime: engine.mime,
      ...(wantTimings && side.timings ? { timings: side.timings } : {}),
      cached: true,
      source: 'primary',
    };
  }

  /** Text -> cached audio file. A second identical call makes no engine call and spends no budget. */
  async speak(personaId: string, text: string, opts: SpeakOptions = {}): Promise<SpeakResult> {
    const clean = text.trim();
    if (!clean) throw new Error('speak: empty text');
    await this.o.gate?.(); // before resolving: the probe may still be choosing the voice
    const { voiceId } = this.o.voices.resolve(personaId);
    return this.speakVoice(voiceId, clean, opts);
  }

  /** Same as `speak` but for an explicit voiceId (voice picker previews, podcast hosts). */
  async speakVoice(voiceId: string, text: string, opts: SpeakOptions = {}): Promise<SpeakResult> {
    const clean = text.trim();
    if (!clean) throw new Error('speak: empty text');
    const model = opts.model ?? 'flash';
    const personaId = 'voice';
    const wantT = !!opts.timings;
    const flightKey = `${personaId}|${model}|${voiceId}|${wantT}|${clean}`;
    const existing = this.inflight.get(flightKey);
    if (existing) return existing;
    const p = this.speakUncached(clean, voiceId, model, wantT, opts.signal).finally(() =>
      this.inflight.delete(flightKey),
    );
    this.inflight.set(flightKey, p);
    return p;
  }

  private async speakUncached(
    text: string,
    voiceId: string,
    model: TtsModel,
    wantT: boolean,
    signal?: AbortSignal,
  ): Promise<SpeakResult> {
    const primary = this.o.engine;
    const key = cacheKey(primary.id, model, voiceId, text);
    const hit = await this.lookup(primary, key, wantT);
    if (hit) return hit;

    await this.o.gate?.();
    try {
      this.o.budget?.charge('elevenlabs.chars', text.length);
      return await this.render(
        primary,
        key,
        { voiceId, text, model, ...(signal ? { signal } : {}) },
        wantT,
        'primary',
      );
    } catch (e) {
      const fb = this.o.fallbackEngine;
      const recoverable =
        e instanceof BudgetExceededError ||
        e instanceof TtsHttpError ||
        (e instanceof Error && /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|fake tts/i.test(e.message));
      if (!fb || !recoverable) throw e;
      this.log('tts primary failed, using fallback', {
        reason: e instanceof Error ? e.name : 'error',
        chars: text.length,
      });
      const fvoice = this.o.fallbackVoiceId ?? voiceId;
      const fkey = cacheKey(fb.id, model, fvoice, text);
      const fhit = await this.lookup(fb, fkey, wantT);
      if (fhit) return { ...fhit, source: 'fallback' };
      return this.render(
        fb,
        fkey,
        { voiceId: fvoice, text, model, ...(signal ? { signal } : {}) },
        wantT,
        'fallback',
      );
    }
  }

  private async render(
    engine: TtsEngine,
    key: string,
    req: Parameters<TtsEngine['synth']>[0],
    wantT: boolean,
    source: 'primary' | 'fallback',
  ): Promise<SpeakResult> {
    const out = await this.limiter.run(() =>
      wantT ? engine.synthWithTimings(req) : engine.synth(req),
    );
    const p = this.paths(engine, key);
    await writeFileEnsured(p.audio, out.audio);
    const durationMs = await probeDurationMs(p.audio);
    const timings = 'timings' in out ? out.timings : undefined;
    await writeFileEnsured(
      p.meta,
      JSON.stringify({ durationMs, ...(timings ? { timings } : {}) } satisfies Sidecar),
    );
    return {
      path: p.audio,
      durationMs,
      mime: engine.mime,
      ...(timings ? { timings } : {}),
      cached: false,
      source,
    };
  }

  /**
   * Streaming synth for live use: yields audio chunks as they arrive. Not cached (callers that
   * need replay use `speak`). Accepts text or token stream; tokens are joined to sentences first.
   */
  async *streamSpeak(
    personaId: string,
    text: AsyncIterable<string> | string,
    opts: { model?: TtsModel; signal?: AbortSignal } = {},
  ): AsyncIterable<{ audio: Uint8Array; sentence: string }> {
    await this.o.gate?.();
    const { voiceId } = this.o.voices.resolve(personaId);
    for await (const sentence of sentences(text)) {
      this.o.budget?.charge('elevenlabs.chars', sentence.length);
      const req = {
        voiceId,
        text: sentence,
        model: opts.model ?? 'flash',
        ...(opts.signal ? { signal: opts.signal } : {}),
      };
      for await (const audio of this.o.engine.stream(req)) yield { audio, sentence };
    }
  }

  /** Raw access for the podcast renderer (dialogue chunks) with the same limiter and budget. */
  async dialogue(
    inputs: { voiceId: string; text: string }[],
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    await this.o.gate?.();
    const e = this.o.engine;
    if (!e.dialogue) throw new Error(`engine ${e.id} has no dialogue endpoint`);
    this.o.budget?.charge(
      'elevenlabs.chars',
      inputs.reduce((s, i) => s + i.text.length, 0),
    );
    return this.limiter.run(() => e.dialogue!(inputs, signal));
  }

  get engineInfo() {
    return {
      id: this.o.engine.id,
      ext: this.o.engine.ext,
      mime: this.o.engine.mime,
      hasDialogue: !!this.o.engine.dialogue,
    };
  }
}

/** Split a string or token stream into sentences (emitted as soon as a terminator + space is seen). */
export async function* sentences(src: AsyncIterable<string> | string): AsyncIterable<string> {
  const re = /^(.+?[.!?]["')\]]*)(\s+|$)/s;
  let buf = '';
  const feed = typeof src === 'string' ? [src] : src;
  for await (const tok of feed as AsyncIterable<string> | string[]) {
    buf += tok;
    for (;;) {
      const m = re.exec(buf);
      if (!m || (m[2] === '' && typeof src !== 'string')) break;
      const s = m[1]!.trim();
      buf = buf.slice(m[0].length);
      if (s) yield s;
    }
  }
  if (buf.trim()) yield buf.trim();
}
