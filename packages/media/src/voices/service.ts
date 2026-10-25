import type { ElevenLabsEngine } from '../tts/elevenlabs';
import { writeFileEnsured } from '../tts/audio';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { BudgetGuard } from '../tts/budget';
import { getProfile, resolveProfileKey, VOICE_PROFILES, type VoiceProfile } from './profiles';
import type { VoiceStore } from './store';

export interface VoiceResolution {
  voiceId: string;
  /** True when no saved/overridden voice exists and the stock fallback voice is used. */
  isFallback: boolean;
  profile: VoiceProfile;
}

export interface VoiceServiceOptions {
  store: VoiceStore;
  /** Stock voice used when a persona has no saved voice. Env ELEVENLABS_FALLBACK_VOICE_ID overrides. */
  fallbackVoiceId: string;
  /** Per-persona runtime overrides, e.g. Persona.voiceId from the registry or Student.voiceId. */
  overrides?: (personaId: string) => string | undefined;
  engine?: ElevenLabsEngine;
  budget?: BudgetGuard;
  previewDir?: string;
}

/** Stock premade voice ("Rachel"). From memory, not re-verified here: the live smoke script validates it and the env var overrides it. */
export const DEFAULT_FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export class VoiceService {
  constructor(private readonly o: VoiceServiceOptions) {}

  resolve(personaId: string): VoiceResolution {
    const profile = getProfile(personaId);
    const override = this.o.overrides?.(personaId);
    const saved =
      override ?? this.o.store.get(personaId) ?? this.o.store.get(resolveProfileKey(personaId));
    return { voiceId: saved ?? this.o.fallbackVoiceId, isFallback: !saved, profile };
  }

  private need(): ElevenLabsEngine {
    if (!this.o.engine)
      throw new Error('voice design needs an ElevenLabs engine (ELEVENLABS_API_KEY)');
    return this.o.engine;
  }

  /** Returns up to 3 previews; audio is written to previewDir so the web picker can play them. */
  async designVoice(
    description: string,
  ): Promise<{ previews: { generatedVoiceId: string; audioPath: string }[] }> {
    const engine = this.need();
    const previews = await engine.designVoice(description);
    const dir = this.o.previewDir ?? join(process.cwd(), 'cache', 'voice-previews');
    const out = [];
    for (const p of previews) {
      const audioPath = join(
        dir,
        `${createHash('sha256').update(p.generatedVoiceId).digest('hex').slice(0, 16)}.mp3`,
      );
      await writeFileEnsured(audioPath, p.audio);
      out.push({ generatedVoiceId: p.generatedVoiceId, audioPath });
    }
    return { previews: out };
  }

  async saveVoice(generatedVoiceId: string, name: string, description = name): Promise<string> {
    return this.need().saveVoice(generatedVoiceId, name, description);
  }

  /**
   * Idempotent: designs and saves a voice for every profile key lacking one (first preview wins).
   * Used by scripts/design-voices. Returns the keys it created.
   */
  async ensureProfileVoices(keys?: string[]): Promise<Record<string, string>> {
    const created: Record<string, string> = {};
    for (const p of VOICE_PROFILES) {
      if (keys && !keys.includes(p.key)) continue;
      if (this.o.store.get(p.key)) continue;
      const { previews } = await this.designVoice(p.description);
      const first = previews[0];
      if (!first) continue;
      const voiceId = await this.saveVoice(first.generatedVoiceId, p.name, p.description);
      this.o.store.set(p.key, voiceId);
      created[p.key] = voiceId;
    }
    return created;
  }
}
