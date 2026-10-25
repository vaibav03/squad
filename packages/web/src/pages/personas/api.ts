import { timedFetch } from '../../lib/http';
import { z } from 'zod';
import { pixelPortrait } from '../../pixel/portraits';
import type { PersonaDraft, VoiceOption } from './fixtures';

const HubPersona = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  voiceId: z.string().optional(),
  avatarUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
});
export const HubPersonas = z.array(HubPersona);
const HubVoice = z.object({
  id: z.string(),
  name: z.string(),
  /** hub-api.md: `{ voices: [{ id, name, label? }] }` */
  label: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
/** The hub wraps the list (`{ voices }`); a bare array is accepted too. */
export const HubVoices = z.union([
  z.array(HubVoice),
  z.object({ voices: z.array(HubVoice) }).transform((o) => o.voices),
]);

/** Hub persona `role` is a kind ('cubbie', 'expert', ...); the page fixtures carry the descriptive copy per kind. */
const KIND_TO_FIXTURE: Record<string, string> = {
  cubbie: 'buddy',
  buddy: 'buddy',
  expert: 'expert',
  examiner: 'examiner',
  dean: 'dean',
  council: 'council',
  rival: 'rival',
};

interface Ctx {
  hubUrl: string;
  token: string | null;
}
const headers = (c: Ctx): Record<string, string> =>
  c.token ? { Authorization: `Bearer ${c.token}` } : {};

export async function fetchPersonas(c: Ctx, fallback: PersonaDraft[]): Promise<PersonaDraft[]> {
  const res = await timedFetch(`${c.hubUrl}/v1/personas`, { headers: headers(c) });
  if (!res.ok) throw new Error(`personas ${res.status}`);
  const parsed = HubPersonas.parse(await res.json());
  return parsed.map((p) => {
    const base =
      fallback.find((f) => f.id === p.id) ??
      fallback.find((f) => f.id === KIND_TO_FIXTURE[p.role]) ??
      fallback[0]!;
    const avatarId =
      [p.avatarUrl, p.role, base.avatarId].find((a) => a && pixelPortrait(a)) ?? base.avatarId;
    return { ...base, id: p.id, name: p.name, avatarId, voiceId: p.voiceId ?? '' };
  });
}
export async function fetchVoices(c: Ctx, fallback: VoiceOption[]): Promise<VoiceOption[]> {
  const res = await timedFetch(`${c.hubUrl}/v1/voices`, { headers: headers(c) });
  if (!res.ok) throw new Error(`voices ${res.status}`);
  const parsed = HubVoices.parse(await res.json());
  return parsed.map((v, i) => ({
    id: v.id,
    name: v.name,
    character: v.description ?? v.label ?? '',
    tags: v.tags ?? (v.label ? [v.label] : []),
    seed: fallback[i % fallback.length]!.seed + i,
    pitch: fallback[i % fallback.length]!.pitch,
  }));
}
export async function savePersona(c: Ctx, p: PersonaDraft): Promise<void> {
  const res = await fetch(`${c.hubUrl}/v1/personas/${encodeURIComponent(p.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers(c) },
    body: JSON.stringify({ voiceId: p.voiceId, avatarUrl: p.avatarId }),
  });
  if (!res.ok) throw new Error(`save ${res.status}`);
}
/** The hub's own words about speech: shown instead of an error when voices are off or still being checked. */
export interface VoiceStatus {
  /** true while the hub's first provider probe is in flight */
  probing: boolean;
  /** true when previews and calls can really speak */
  available: boolean;
  /** why not, in the hub's words (absent when available) */
  notice?: string;
}
const VoiceStatusBody = z.object({
  tts: z.string(),
  probing: z.boolean().optional(),
  ttsNotice: z.string().optional(),
});
export async function fetchVoiceStatus(c: Ctx): Promise<VoiceStatus | null> {
  try {
    const res = await fetch(`${c.hubUrl}/v1/status`);
    if (!res.ok) return null;
    const b = VoiceStatusBody.parse(await res.json());
    return {
      probing: !!b.probing,
      available: b.tts === 'elevenlabs',
      ...(b.ttsNotice ? { notice: b.ttsNotice } : {}),
    };
  } catch {
    return null;
  }
}
/** A preview refused because voices are off (HTTP 503 `voices_unavailable`); `message` is user-safe. */
export class VoicesUnavailable extends Error {}
export async function fetchPreviewBlob(c: Ctx, voiceId: string, text: string): Promise<Blob> {
  const res = await fetch(`${c.hubUrl}/v1/voices/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers(c) },
    body: JSON.stringify({ voiceId, text }),
  });
  if (res.status === 503) {
    const b = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    const m = b?.error?.message;
    if (typeof m === 'string' && m) throw new VoicesUnavailable(m);
  }
  if (!res.ok) throw new Error(`preview ${res.status}`);
  return res.blob();
}
