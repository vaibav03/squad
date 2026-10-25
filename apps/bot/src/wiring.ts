import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Llm } from '@squad/core';
import type { Config } from '@squad/core/node';
import {
  FakeImageGen,
  FakeTts,
  GeminiImageGen,
  MemoryVoiceStore,
  createAudioServices,
  type AudioServices,
} from '@squad/media';
import { listPersonas } from '@squad/media/personas';
import { registerPersonas } from './persona';
import type { MediaWiring } from './skills';

export interface MediaOptions {
  cfg: Config;
  llm: Llm;
  /** FakeTts + FakeImageGen in a temp dir: no keys, no network, no repo writes. */
  fake: boolean;
}

/**
 * Audio and image services for the podcast and explainer skills, or `undefined` (with a reason)
 * when real mode has no ELEVENLABS_API_KEY. Needs ffmpeg and ffprobe on PATH for podcasts.
 */
export function buildMedia(o: MediaOptions): { media?: MediaWiring; reason?: string } {
  let audio: AudioServices;
  let outDir: string;
  if (o.fake) {
    outDir = mkdtempSync(join(tmpdir(), 'squad-media-'));
    audio = createAudioServices({
      config: o.cfg,
      engine: new FakeTts(),
      root: outDir,
      store: new MemoryVoiceStore(),
    });
  } else if (o.cfg.elevenLabsApiKey) {
    audio = createAudioServices({ config: o.cfg });
    outDir = join(audio.cacheDir, '..', 'media');
  } else {
    return { reason: 'ELEVENLABS_API_KEY is not set: podcast and explainer skills not registered' };
  }
  const imageGen = o.fake
    ? new FakeImageGen()
    : o.cfg.geminiApiKey
      ? new GeminiImageGen({ apiKey: o.cfg.geminiApiKey })
      : undefined;
  return {
    media: {
      podcast: { llm: o.llm, tts: audio.tts, voices: audio.voices },
      explainer: { llm: o.llm, budget: audio.budget, ...(imageGen ? { imageGen } : {}) },
      outDir,
    },
  };
}

/** Register the media persona set (names, emoji, voices) with the bot's reply formatter. */
export function registerMediaPersonas(): number {
  const list = listPersonas();
  registerPersonas(list);
  return list.length;
}
