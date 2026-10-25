import type { Persona } from '@squad/core';
import type { MediaPort } from '../ports';

// Silent MPEG-1 Layer III frames (32 kbps, 44.1 kHz mono): 26 frames of 104 zero bytes after a valid header.
const FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x10, 0xc4]), Buffer.alloc(100)]);
const SILENT_MP3 = new Uint8Array(Buffer.concat(Array.from({ length: 26 }, () => FRAME)));

const PERSONAS: Persona[] = [
  {
    id: 'persona_pip',
    name: 'Pip',
    role: 'cubbie',
    systemPrompt: 'Friendly squad guide.',
    emoji: 'P',
  },
  {
    id: 'persona_ada',
    name: 'Prof Ada',
    role: 'expert',
    systemPrompt: 'Patient chapter expert.',
    emoji: 'A',
  },
  {
    id: 'persona_quill',
    name: 'Quill',
    role: 'examiner',
    systemPrompt: 'Fair but firm examiner.',
    emoji: 'Q',
  },
  {
    id: 'persona_dean',
    name: 'The Dean',
    role: 'dean',
    systemPrompt: 'Dry-witted dean.',
    emoji: 'D',
  },
];
const VOICES = [
  { id: 'voice_calm', name: 'Calm professor', label: 'calm' },
  { id: 'voice_hype', name: 'Hype coach', label: 'energetic' },
  { id: 'voice_dry', name: 'Dry dean', label: 'dry' },
];

export function createStubMedia(): MediaPort {
  const personas = structuredClone(PERSONAS);
  return {
    async personas() {
      return structuredClone(personas);
    },
    async updatePersona(id, patch) {
      const p = personas.find((x) => x.id === id);
      if (!p) return null;
      if (patch.voiceId !== undefined) p.voiceId = patch.voiceId;
      if (patch.avatarUrl !== undefined) p.avatarUrl = patch.avatarUrl;
      return structuredClone(p);
    },
    async voices() {
      return structuredClone(VOICES);
    },
    async preview(voiceId) {
      return VOICES.some((v) => v.id === voiceId) ? { mime: 'audio/mpeg', data: SILENT_MP3 } : null;
    },
  };
}
