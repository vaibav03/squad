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
