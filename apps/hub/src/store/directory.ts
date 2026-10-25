import { isSmallGroup as small, meetsMinGroupSize, type Student } from '@squad/core';
import type { Directory, SquadRec, SquadSettings } from '../types';

const DEFAULT_SETTINGS: SquadSettings = { revealQuizCorrectness: false };

export function createDirectory(): Directory {
  const students = new Map<string, Student>();
  const squads = new Map<string, SquadRec>();
  const settings = new Map<string, SquadSettings>();

  const squadOf = (id: string) => [...squads.values()].find((s) => s.members.includes(id))?.id;

  return {
    upsertStudent: (s) => void students.set(s.id, { ...s }),
    upsertSquad: (s) => void squads.set(s.id, { ...s, members: [...s.members] }),
    student: (id) => students.get(id),
    students: () => [...students.values()],
    squad: (id) => squads.get(id),
    squadOf,
    members(squadId) {
      const sq = squads.get(squadId);
      return sq ? sq.members.flatMap((m) => students.get(m) ?? []) : [];
    },
    visibleMemberCount(squadId) {
      const n = squads.get(squadId)?.members.length ?? 0;
      return meetsMinGroupSize(n) ? n : null;
    },
    isSmall: (squadId) => small(squads.get(squadId)?.members.length ?? 0),
    settings: (squadId) => ({ ...DEFAULT_SETTINGS, ...settings.get(squadId) }),
    setSettings(squadId, patch) {
      const next = { ...DEFAULT_SETTINGS, ...settings.get(squadId), ...patch };
      settings.set(squadId, next);
      return { ...next };
    },
    clear() {
      students.clear();
      squads.clear();
      settings.clear();
    },
  };
}
