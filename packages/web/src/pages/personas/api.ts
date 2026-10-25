import { z } from 'zod';
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
export const HubVoices = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
);

interface Ctx {
  hubUrl: string;
  token: string | null;
}
const headers = (c: Ctx): Record<string, string> =>
  c.token ? { Authorization: `Bearer ${c.token}` } : {};

export async function fetchPersonas(c: Ctx, fallback: PersonaDraft[]): Promise<PersonaDraft[]> {
  const res = await fetch(`${c.hubUrl}/v1/personas`, { headers: headers(c) });
  if (!res.ok) throw new Error(`personas ${res.status}`);
  const parsed = HubPersonas.parse(await res.json());
  return parsed.map((p) => {
    const base = fallback.find((f) => f.id === p.id) ?? fallback[0]!;
    return { ...base, id: p.id, name: p.name, role: p.role, voiceId: p.voiceId ?? base.voiceId };
  });
}
export async function fetchVoices(c: Ctx, fallback: VoiceOption[]): Promise<VoiceOption[]> {
  const res = await fetch(`${c.hubUrl}/v1/voices`, { headers: headers(c) });
  if (!res.ok) throw new Error(`voices ${res.status}`);
  const parsed = HubVoices.parse(await res.json());
  return parsed.map((v, i) => ({
    id: v.id,
    name: v.name,
    character: v.description ?? '',
    tags: v.tags ?? [],
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
export async function fetchPreviewBlob(c: Ctx, voiceId: string, text: string): Promise<Blob> {
  const res = await fetch(`${c.hubUrl}/v1/voices/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers(c) },
    body: JSON.stringify({ voiceId, text }),
  });
  if (!res.ok) throw new Error(`preview ${res.status}`);
  return res.blob();
}
