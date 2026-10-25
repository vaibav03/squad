import { describe, expect, it } from 'vitest';
import { openMemoryDb } from '@squad/core/node';
import { seedRoster } from './store';
import type { Roster } from './types';

const roster = (handles: [string, string][]): Roster =>
  ({
    students: handles.map(([id, handle]) => ({ id, name: id, handle })),
    chats: [],
  }) as unknown as Roster;

describe('seedRoster', () => {
  it('starts even when two accounts share a masked handle (hub restart with 2+ signed-up users)', () => {
    const db = openMemoryDb();
    const r = {
      students: [
        { id: 'u_aaa', name: 'Maya', handle: 'j•••@example.com' },
        { id: 'u_bbb', name: 'Noor', handle: 'j•••@example.com' },
      ],
      chats: [],
    };
    seedRoster(db, r, 'web');
    seedRoster(db, r, 'web'); // a second start over the same database
    const rows = db.prepare('SELECT id, handle FROM students ORDER BY id').all() as {
      id: string;
      handle: string;
    }[];
    expect(rows.map((x) => x.id)).toEqual(['u_aaa', 'u_bbb']);
    expect(new Set(rows.map((x) => x.handle)).size).toBe(2);
  });

  it('survives two accounts that share a masked contact hint, and a second boot', () => {
    const db = openMemoryDb();
    const r = roster([
      ['u_1', 'r•••@example.com'],
      ['u_2', 'r•••@example.com'],
    ]);
    seedRoster(db, r, 'web');
    expect(() => seedRoster(db, r, 'web')).not.toThrow();
    const rows = db.prepare('SELECT id, handle FROM students ORDER BY id').all() as {
      id: string;
      handle: string;
    }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.handle)).size).toBe(2);
  });
});
