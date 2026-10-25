import type { PersonaDraft } from './fixtures';

export interface PersonasState {
  selected: string;
  saved: Record<string, PersonaDraft>;
  drafts: Record<string, PersonaDraft>;
}
export type PAction =
  | { type: 'select'; id: string }
  | { type: 'edit'; patch: Partial<Pick<PersonaDraft, 'voiceId' | 'avatarId' | 'sample'>> }
  | { type: 'reset' }
  | { type: 'saved'; id: string };

export function initPersonas(list: PersonaDraft[]): PersonasState {
  const saved = Object.fromEntries(list.map((p) => [p.id, p]));
  return { selected: list[0]?.id ?? '', saved, drafts: { ...saved } };
}
export function isDirty(s: PersonasState, id = s.selected): boolean {
  const a = s.saved[id],
    b = s.drafts[id];
  return (
    !!a && !!b && (a.voiceId !== b.voiceId || a.avatarId !== b.avatarId || a.sample !== b.sample)
  );
}
export function personasReducer(s: PersonasState, a: PAction): PersonasState {
  switch (a.type) {
    case 'select':
      return s.drafts[a.id] ? { ...s, selected: a.id } : s;
    case 'edit':
      return {
        ...s,
        drafts: { ...s.drafts, [s.selected]: { ...s.drafts[s.selected]!, ...a.patch } },
      };
    case 'reset':
      return { ...s, drafts: { ...s.drafts, [s.selected]: s.saved[s.selected]! } };
    case 'saved':
      return { ...s, saved: { ...s.saved, [a.id]: s.drafts[a.id]! } };
  }
}
