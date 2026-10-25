import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';
import { SENTINELS } from '@squad/core';
import { parseIcs, type IcsEvent } from './calendar';
import {
  CourseFileSchema,
  LodgingFileSchema,
  PersonasFileSchema,
  StudentsFileSchema,
  type CourseFile,
  type LodgingFile,
  type PersonaSeed,
  type StudentsFile,
} from './schema';
import { SEED_DIR } from './paths';

export interface SeedPack {
  students: StudentsFile;
  lodging: LodgingFile;
  course: CourseFile;
  personas: PersonaSeed[];
  /** Raw .ics text per student id (PRIVATE). */
  calendars: Record<string, string>;
  /** Parsed events per student id (PRIVATE). */
  events: Record<string, IcsEvent[]>;
}

function readJson<S extends z.ZodType>(dir: string, file: string, schema: S): z.infer<S> {
  const p = path.join(dir, file);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`seed: cannot read ${file}: ${(e as Error).message}`);
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`seed: ${file} is invalid:\n${issues.join('\n')}`);
  }
  return r.data;
}

/** Load and fully validate the pack (schemas, calendars parse, cross references). Throws on any problem. */
export function loadSeedPack(dir = SEED_DIR): SeedPack {
  const students = readJson(dir, 'students.json', StudentsFileSchema);
  const lodging = readJson(dir, 'lodging.json', LodgingFileSchema);
  const course = readJson(dir, 'course.json', CourseFileSchema);
  const personas = readJson(dir, 'personas.json', PersonasFileSchema);

  const personaIds = new Set(personas.map((p) => p.id));
  const calendars: Record<string, string> = {};
  const events: Record<string, IcsEvent[]> = {};
  for (const s of students.students) {
    if (!personaIds.has(s.personaId))
      throw new Error(`seed: ${s.id} references unknown persona ${s.personaId}`);
    const text = fs.readFileSync(path.join(dir, s.calendar), 'utf8');
    try {
      events[s.id] = parseIcs(text);
    } catch (e) {
      throw new Error(`seed: ${s.calendar}: ${(e as Error).message}`);
    }
    calendars[s.id] = text;
  }
  return { students, lodging, course, personas, calendars, events };
}

/** Everything that may appear in events, logs, the web UI or the group chat. No private field, no calendar. */
export function publicSeedView(pack: SeedPack): unknown {
  return {
    squadId: pack.students.squadId,
    chatId: pack.students.chatId,
    students: pack.students.students.map(({ id, name, handle, personaId }) => ({
      id,
      name,
      handle,
      personaId,
    })),
    lodging: pack.lodging,
    course: pack.course,
    personas: pack.personas,
  };
}

/** Everything that is private to a student's own agent. */
export function privateSeedView(pack: SeedPack): unknown {
  return {
    students: pack.students.students.map((s) => ({ id: s.id, private: s.private })),
    calendars: pack.calendars,
  };
}

/** Sentinels that are planted somewhere private (so a leak check has something to catch). */
export function plantedSentinels(pack: SeedPack): string[] {
  const priv = JSON.stringify(privateSeedView(pack)).toLowerCase();
  return SENTINELS.filter((s) => priv.includes(s.toLowerCase()));
}
