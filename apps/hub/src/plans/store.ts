import type { Db, Plan } from '@squad/core';

/** Plans live in the shared sqlite, one JSON row each, written through on every change. */
export interface PlanStore {
  get(id: string): Plan | undefined;
  /** Newest first. */
  list(squadId: string): Plan[];
  /** The plan the squad is working on: newest proposed/active one. */
  current(squadId: string): Plan | undefined;
  save(p: Plan): void;
  forgetStudent(studentId: string): void;
  clear(): void;
}

export function createPlanStore(db: Db): PlanStore {
  db.exec(`CREATE TABLE IF NOT EXISTS hub_plans(
    id TEXT PRIMARY KEY, squad_id TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS hub_plans_squad ON hub_plans(squad_id, updated_at)');
  const plans = new Map<string, Plan>();
  for (const r of db.prepare('SELECT json FROM hub_plans').all() as { json: string }[]) {
    const p = JSON.parse(r.json) as Plan;
    plans.set(p.id, p);
  }
  const put = db.prepare(
    'INSERT INTO hub_plans(id, squad_id, json, updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at',
  );
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    get: (id) => (plans.has(id) ? clone(plans.get(id)!) : undefined),
    list: (squadId) =>
      [...plans.values()]
        .filter((p) => p.squadId === squadId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(clone),
    current(squadId) {
      const p = [...plans.values()]
        .filter((x) => x.squadId === squadId && (x.status === 'proposed' || x.status === 'active'))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return p ? clone(p) : undefined;
    },
    save(p) {
      const c = clone(p);
      plans.set(c.id, c);
      put.run(c.id, c.squadId, JSON.stringify(c), c.updatedAt);
    },
    forgetStudent(studentId) {
      for (const p of plans.values()) {
        const had = p.members.some((m) => m.id === studentId);
        if (!had) continue;
        const rest = p.members.filter((m) => m.id !== studentId);
        const fallback = rest.find((m) => m.optedIn)?.id;
        p.members = rest;
        p.items = p.items.flatMap((i) => {
          if (i.ownerId !== studentId) return [i];
          if (!fallback) return [];
          return [{ ...i, ownerId: fallback, ownerName: rest.find((m) => m.id === fallback)!.name }];
        });
        p.log = p.log.filter((l) => l.by !== studentId);
        put.run(p.id, p.squadId, JSON.stringify(p), p.updatedAt);
      }
    },
    clear() {
      plans.clear();
      db.exec('DELETE FROM hub_plans');
    },
  };
}
