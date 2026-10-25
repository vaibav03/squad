import type { Persona } from '@squad/core';
import type { TtsService } from '../tts/service';
import { VOICE_PROFILES } from '../voices/profiles';
import type { VoiceStore } from '../voices/store';

export const MAX_PREVIEW_CHARS = 400;

/** Structurally the hub's MediaPort (docs/hub-api.md section 11). */
export interface MediaPort {
  personas(): Promise<Persona[]>;
  updatePersona(
    id: string,
    patch: { voiceId?: string; avatarUrl?: string },
  ): Promise<Persona | null>;
  voices(): Promise<{ id: string; name: string; label?: string }[]>;
  preview(voiceId: string, text: string): Promise<{ mime: string; data: Uint8Array } | null>;
}

export interface MediaPortOptions {
  personas: () => Persona[];
  /** Persist a persona edit (registry owned by media-art). Return the updated persona or null. */
  updatePersona?: (id: string, patch: { voiceId?: string; avatarUrl?: string }) => Persona | null;
  tts: Pick<TtsService, 'speakVoice'>;
  store: VoiceStore;
}

export function createMediaPort(o: MediaPortOptions): MediaPort {
  return {
    async personas() {
      return o.personas().map((p) => {
        const saved = o.store.get(p.id);
        return saved && !p.voiceId ? { ...p, voiceId: saved } : p;
      });
    },
    async updatePersona(id, patch) {
      if (patch.voiceId) o.store.set(id, patch.voiceId);
      return o.updatePersona?.(id, patch) ?? o.personas().find((p) => p.id === id) ?? null;
    },
    async voices() {
      const saved = o.store.all();
      const out: { id: string; name: string; label?: string }[] = [];
      const seen = new Set<string>();
      for (const p of VOICE_PROFILES) {
        const id = saved[p.key];
        if (id && !seen.has(id)) {
          seen.add(id);
          out.push({ id, name: p.name, label: p.style });
        }
      }
      for (const [k, id] of Object.entries(saved)) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ id, name: k });
        }
      }
      return out;
    },
    async preview(voiceId, text) {
      const t = text.trim().slice(0, MAX_PREVIEW_CHARS);
      if (!voiceId || !t) return null;
      const r = await o.tts.speakVoice(voiceId, t);
      const { readFile } = await import('node:fs/promises');
      return { mime: r.mime, data: new Uint8Array(await readFile(r.path)) };
    },
  };
}
