import type { Db } from '@squad/core';
import type { MemoryApi } from './types';

export function createMemory(db: Db, now: () => number = Date.now): MemoryApi {
  const get = db.prepare('SELECT value_json FROM memory WHERE scope=? AND scope_id=? AND key=?');
  const set = db.prepare(
    `INSERT INTO memory(scope, scope_id, key, value_json, ts) VALUES(?,?,?,?,?)
     ON CONFLICT(scope, scope_id, key) DO UPDATE SET value_json=excluded.value_json, ts=excluded.ts`,
  );
  const del = db.prepare('DELETE FROM memory WHERE scope=? AND scope_id=? AND key=?');
  const list = db.prepare('SELECT key, value_json FROM memory WHERE scope=? AND scope_id=?');
  return {
    get<T>(scope: 'student' | 'chat', id: string, key: string) {
      const r = get.get(scope, id, key) as { value_json: string } | undefined;
      return r ? (JSON.parse(r.value_json) as T) : undefined;
    },
    set(scope, id, key, value) {
      set.run(scope, id, key, JSON.stringify(value ?? null), now());
    },
    delete(scope, id, key) {
      del.run(scope, id, key);
    },
    list(scope, id) {
      const out: Record<string, unknown> = {};
      for (const r of list.all(scope, id) as { key: string; value_json: string }[]) {
        out[r.key] = JSON.parse(r.value_json);
      }
      return out;
    },
  };
}
