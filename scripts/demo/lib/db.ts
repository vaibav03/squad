import type { Db } from '@squad/core';
import type { SeedPack } from './seedpack';

const DDL = `
CREATE TABLE IF NOT EXISTS demo_seed(
  kind TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, seeded_at INTEGER NOT NULL,
  PRIMARY KEY(kind, key));
`;

export interface SeedSummary {
  students: number;
  calendars: number;
  busyBlocks: number;
  lodgingOptions: number;
  chapters: number;
  personas: number;
}

/** Idempotent: re-running upserts the same rows. `now` is injectable for deterministic tests. */
export function seedDb(db: Db, pack: SeedPack, now = Date.now()): SeedSummary {
  db.exec(DDL);
  const put = db.prepare(
    `INSERT INTO demo_seed(kind, key, json, seeded_at) VALUES(?,?,?,?)
     ON CONFLICT(kind, key) DO UPDATE SET json = excluded.json, seeded_at = excluded.seeded_at`,
  );
  const upStudent = db.prepare(
    `INSERT INTO students(id, name, handle, persona_id, created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, handle = excluded.handle, persona_id = excluded.persona_id`,
  );
  const upChat = db.prepare(
    `INSERT INTO chats(id, is_group, name, transport, settings_json) VALUES(?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  );
  const upMember = db.prepare(
    `INSERT OR IGNORE INTO chat_members(chat_id, student_id) VALUES(?,?)`,
  );
  let busyBlocks = 0;
  db.transaction(() => {
    for (const s of pack.students.students) {
      upStudent.run(s.id, s.name, s.handle, s.personaId, now);
      upMember.run(pack.students.chatId, s.id);
      put.run('agent_private', s.id, JSON.stringify(s.private), now);
      put.run('calendar_ics', s.id, pack.calendars[s.id] ?? '', now);
      busyBlocks += pack.events[s.id]?.length ?? 0;
    }
    upChat.run(pack.students.chatId, 1, pack.course.groupName, 'sim', '{}');
    put.run('lodging', pack.lodging.trip.tripId, JSON.stringify(pack.lodging), now);
    put.run('course', pack.course.courseId, JSON.stringify(pack.course), now);
    for (const p of pack.personas) put.run('persona', p.id, JSON.stringify(p), now);
  })();
  return {
    students: pack.students.students.length,
    calendars: Object.keys(pack.calendars).length,
    busyBlocks,
    lodgingOptions: pack.lodging.options.length,
    chapters: pack.course.chapters.length,
    personas: pack.personas.length,
  };
}

/** Removes only demo rows (by seeded ids) and the group's messages. Safe on a db with no demo_seed table. */
export function resetDb(db: Db, pack: SeedPack): void {
  db.exec(DDL);
  const ids = pack.students.students.map((s) => s.id);
  const chat = pack.students.chatId;
  const marks = ids.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chat);
    db.prepare(`DELETE FROM pending_confirms WHERE student_id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM memory WHERE scope_id IN (${marks}) OR scope_id = ?`).run(
      ...ids,
      pack.students.squadId,
    );
    db.prepare('DELETE FROM chat_members WHERE chat_id = ?').run(chat);
    db.prepare('DELETE FROM chats WHERE id = ?').run(chat);
    db.prepare(`DELETE FROM students WHERE id IN (${marks})`).run(...ids);
    db.prepare('DELETE FROM demo_seed').run();
  })();
}

export function countDemoRows(db: Db): number {
  db.exec(DDL);
  return (db.prepare('SELECT COUNT(*) AS n FROM demo_seed').get() as { n: number }).n;
}
