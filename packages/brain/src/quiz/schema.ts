import type { Db } from '@squad/core';

export function ensureQuizSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quiz_rounds(
      quizId TEXT PRIMARY KEY, courseId TEXT NOT NULL, chapter TEXT NOT NULL, via TEXT NOT NULL,
      target TEXT, students_json TEXT NOT NULL, phase TEXT NOT NULL, idx INTEGER NOT NULL,
      total INTEGER NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quiz_items(
      quizId TEXT NOT NULL, idx INTEGER NOT NULL, kind TEXT NOT NULL, question TEXT NOT NULL,
      choices_json TEXT, key_json TEXT NOT NULL, explanation TEXT, cite_json TEXT,
      PRIMARY KEY(quizId, idx));
    CREATE TABLE IF NOT EXISTS quiz_answers(
      quizId TEXT NOT NULL, idx INTEGER NOT NULL, student TEXT NOT NULL, answer_json TEXT NOT NULL,
      correct INTEGER, feedback TEXT NOT NULL, ts INTEGER NOT NULL,
      PRIMARY KEY(quizId, idx, student));
  `);
}
