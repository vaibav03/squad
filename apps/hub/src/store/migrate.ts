import type { Db } from '@squad/core';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Applies numbered migrations once each, in order, inside a transaction. Idempotent across restarts. */
export function runMigrations(db: Db, scope: string, migrations: Migration[]): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS acct_migrations(scope TEXT NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL, applied_at INTEGER NOT NULL, PRIMARY KEY(scope, id))',
  );
  const done = new Set(
    (db.prepare('SELECT id FROM acct_migrations WHERE scope=?').all(scope) as { id: number }[]).map(
      (r) => r.id,
    ),
  );
  for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO acct_migrations(scope,id,name,applied_at) VALUES(?,?,?,?)').run(
        scope,
        m.id,
        m.name,
        Date.now(),
      );
    })();
  }
}
