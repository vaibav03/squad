import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import { seedRoster } from './store';

describe('seedRoster', () => {
  it('starts even when two accounts share a masked handle (hub restart with 2+ signed-up users)', () => {
    const db = openMemoryDb();
    const roster = {
      students: [
        { id: 'u_aaa', name: 'Maya', handle: 'j•••@example.com' },
        { id: 'u_bbb', name: 'Noor', handle: 'j•••@example.com' },
      ],
      chats: [],
    };
    seedRoster(db, roster, 'web');
    seedRoster(db, roster, 'web'); // a second start over the same database
    const rows = db.prepare('SELECT id, handle FROM students ORDER BY id').all() as {
      id: string;
      handle: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual(['u_aaa', 'u_bbb']);
    expect(new Set(rows.map((r) => r.handle)).size).toBe(2);
  });
});
