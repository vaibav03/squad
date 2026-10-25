import type { Db } from '@squad/core';

export function ensureMasterySchema(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS mastery(
    student TEXT NOT NULL, courseId TEXT NOT NULL, chapter TEXT NOT NULL,
    box INTEGER NOT NULL, nextDue INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    PRIMARY KEY(student, courseId, chapter))`);
}
