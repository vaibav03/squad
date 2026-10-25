import { isSmallGroup as small, meetsMinGroupSize, type Student } from '@squad/core';
import type { Db } from '@squad/core';
import type { Directory, SquadRec, SquadSettings } from '../types';
import { ensureHubSchema } from './schema';

const DEFAULT_SETTINGS: SquadSettings = { revealQuizCorrectness: false };

/** In-memory maps, written through to the shared sqlite when `db` is given (and loaded from it at start). */
export function createDirectory(db?: Db): Directory {
  const students = new Map<string, Student>();
  const squads = new Map<string, SquadRec>();
  const settings = new Map<string, SquadSettings>();
  const save = (table: string, id: string, v: unknown) =>
    db
      ?.prepare(
        `INSERT INTO ${table} VALUES(?, ?) ON CONFLICT(${table === 'hub_squad_settings' ? 'squad_id' : 'id'}) DO UPDATE SET json=excluded.json`,
      )
      .run(id, JSON.stringify(v));
  if (db) {
    ensureHubSchema(db);
    for (const r of db.prepare('SELECT id, json FROM hub_students').all() as {
      id: string;
      json: string;
    }[])
      students.set(r.id, JSON.parse(r.json) as Student);
    for (const r of db.prepare('SELECT id, json FROM hub_squads').all() as {
      id: string;
      json: string;
    }[])
      squads.set(r.id, JSON.parse(r.json) as SquadRec);
    for (const r of db.prepare('SELECT squad_id, json FROM hub_squad_settings').all() as {
      squad_id: string;
      json: string;
    }[])
      settings.set(r.squad_id, JSON.parse(r.json) as SquadSettings);
  }

  const squadOf = (id: string) => [...squads.values()].find((s) => s.members.includes(id))?.id;

  return {
    upsertStudent(s) {
      students.set(s.id, { ...s });
      save('hub_students', s.id, s);
    },
    upsertSquad(s) {
      squads.set(s.id, { ...s, members: [...s.members] });
      save('hub_squads', s.id, s);
    },
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
      save('hub_squad_settings', squadId, next);
      return { ...next };
    },
    clear() {
      students.clear();
      squads.clear();
      settings.clear();
      db?.exec('DELETE FROM hub_students; DELETE FROM hub_squads; DELETE FROM hub_squad_settings;');
    },
  };
}
