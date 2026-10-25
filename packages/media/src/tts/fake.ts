import { createHash } from 'node:crypto';
import { toneWav } from './audio';
import type { CharTiming, DialogueInput, SynthRequest, SynthResult, TtsEngine } from './types';

/** ~14 chars/second, floor 400 ms: stable, text-length based fake speech duration. */
export function fakeDurationMs(text: string): number {
  return Math.max(400, Math.round((text.length / 14) * 1000));
}

function hz(voiceId: string): number {
  const h = createHash('sha256').update(voiceId).digest();
  return 180 + (h[0]! % 12) * 40; // distinct pitch per voice
}

/** Deterministic offline engine: real WAV bytes (so ffmpeg works), no network. Records calls for assertions. */
export class FakeTts implements TtsEngine {
  readonly id = 'fake';
  readonly ext = 'wav' as const;
  readonly mime = 'audio/wav';
  readonly calls: { kind: string; voiceId: string; text: string }[] = [];
  /** Set to make the next N calls throw (to test fallback). */
  failNext = 0;
  failWith: Error = new Error('fake tts failure');

  private maybeFail(): void {
    if (this.failNext > 0) {
      this.failNext--;
      throw this.failWith;
    }
  }

  async synth(r: SynthRequest): Promise<SynthResult> {
    this.calls.push({ kind: 'synth', voiceId: r.voiceId, text: r.text });
    this.maybeFail();
    return { audio: toneWav(fakeDurationMs(r.text), hz(r.voiceId)) };
  }

  async synthWithTimings(r: SynthRequest): Promise<SynthResult & { timings: CharTiming[] }> {
    const { audio } = await this.synth(r);
    const per = fakeDurationMs(r.text) / Math.max(1, r.text.length);
    const timings = [...r.text].map((char, i) => ({
      char,
      startMs: Math.round(i * per),
      endMs: Math.round((i + 1) * per),
    }));
    return { audio, timings };
  }

  async *stream(r: SynthRequest): AsyncIterable<Uint8Array> {
    const { audio } = await this.synth(r);
    const step = 8192;
    for (let i = 0; i < audio.length; i += step) yield audio.slice(i, i + step);
  }

  async dialogue(inputs: DialogueInput[]): Promise<Uint8Array> {
    this.calls.push({
      kind: 'dialogue',
      voiceId: inputs.map((i) => i.voiceId).join(','),
      text: inputs.map((i) => i.text).join('|'),
    });
    this.maybeFail();
    const parts = inputs.map((i) => toneWav(fakeDurationMs(i.text), hz(i.voiceId)));
    const pcm = parts.map((p) => Buffer.from(p).subarray(44));
    const data = Buffer.concat(pcm);
    const head = Buffer.from(parts[0]!).subarray(0, 44);
    head.writeUInt32LE(36 + data.length, 4);
    head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
  }
}
