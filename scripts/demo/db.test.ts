import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import { countDemoRows, resetDb, seedDb } from './lib/db';
import { loadSeedPack } from './lib/seedpack';

const pack = loadSeedPack();

describe('seed db', () => {
  it('is idempotent', () => {
    const db = openMemoryDb();
    const a = seedDb(db, pack, 1000);
    const rows = countDemoRows(db);
    const b = seedDb(db, pack, 2000);
    expect(b).toEqual(a);
    expect(countDemoRows(db)).toBe(rows);
    expect((db.prepare('SELECT COUNT(*) n FROM students').get() as { n: number }).n).toBe(4);
    expect((db.prepare('SELECT COUNT(*) n FROM chat_members').get() as { n: number }).n).toBe(4);
  });

  it('keeps private fields in demo_seed only, never in students/chats', () => {
    const db = openMemoryDb();
    seedDb(db, pack);
    const core = JSON.stringify([
      db.prepare('SELECT * FROM students').all(),
      db.prepare('SELECT * FROM chats').all(),
    ]);
    expect(core.toLowerCase()).not.toContain('$180');
    expect(core.toLowerCase()).not.toContain('therapy');
  });

  it('reset clears demo rows and the group, then reseed restores them', () => {
    const db = openMemoryDb();
    seedDb(db, pack);
    db.prepare('INSERT INTO messages(chat_id, from_id, text, ts) VALUES(?,?,?,?)').run(
      'chat_demo',
      's_ana',
      'hi',
      1,
    );
    resetDb(db, pack);
    expect(countDemoRows(db)).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM messages').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM students').get() as { n: number }).n).toBe(0);
    seedDb(db, pack);
    expect(countDemoRows(db)).toBeGreaterThan(0);
  });

  it('reset leaves unrelated rows alone', () => {
    const db = openMemoryDb();
    seedDb(db, pack);
    db.prepare('INSERT INTO students(id, name, handle) VALUES(?,?,?)').run(
      's_other',
      'Other',
      'o@example.com',
    );
    resetDb(db, pack);
    expect((db.prepare('SELECT COUNT(*) n FROM students').get() as { n: number }).n).toBe(1);
  });
});
