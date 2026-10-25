import { CouncilResultSchema, type CouncilResult } from '@squad/core';
import { emptyResult, runAskCouncil } from './ask-run';
import {
  CouncilBusyError,
  type CouncilAskInput,
  type CouncilLimits,
  type CouncilRunHandle,
  type CouncilService,
  type CouncilServiceDeps,
} from './ask-types';

export const DEFAULT_LIMITS: CouncilLimits = {
  callTimeoutMs: 25_000,
  runTimeoutMs: 90_000,
  maxActivePerAsker: 1,
  maxPerAskerPerHour: 12,
};
const KEEP = 200;
const HOUR = 3_600_000;

function randomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `cn_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

/**
 * The general-purpose council: three members with distinct stances, anonymous peer ranking, a chair verdict.
 * Runs in the background; `ask` returns at once. Results are kept in memory and in the `council_runs` table.
 */
export function createCouncilService(deps: CouncilServiceDeps): CouncilService {
  const now = deps.now ?? Date.now;
  const limits: CouncilLimits = { ...DEFAULT_LIMITS, ...deps.limits };
  const newId = deps.newId ?? randomId;
  const course = deps.courseId ?? (() => 'demo');
  const runs = new Map<string, CouncilResult>();
  const subs = new Map<string, Set<(r: CouncilResult) => void>>();
  const active = new Map<string, number>();
  const history = new Map<string, number[]>();
  deps.db.exec(
    'CREATE TABLE IF NOT EXISTS council_runs(id TEXT PRIMARY KEY, json TEXT NOT NULL, updatedAt INTEGER NOT NULL)',
  );
  const save = deps.db.prepare(
    'INSERT INTO council_runs(id, json, updatedAt) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt',
  );
  const load = deps.db.prepare('SELECT json FROM council_runs WHERE id=?');

  const snapshot = (r: CouncilResult): CouncilResult => structuredClone(r);
  const notify = (r: CouncilResult): void => {
    const copy = snapshot(r);
    for (const fn of subs.get(r.id) ?? []) {
      try {
        fn(copy);
      } catch {
        // a broken subscriber must not stop the run
      }
    }
  };

  function ask(input: CouncilAskInput): CouncilRunHandle {
    const t = now();
    if ((active.get(input.askedBy) ?? 0) >= limits.maxActivePerAsker)
      throw new CouncilBusyError('busy');
    const recent = (history.get(input.askedBy) ?? []).filter((x) => t - x < HOUR);
    if (recent.length >= limits.maxPerAskerPerHour) throw new CouncilBusyError('rate_limited');
    history.set(input.askedBy, [...recent, t]);
    active.set(input.askedBy, (active.get(input.askedBy) ?? 0) + 1);

    const visibility = input.visibility ?? (input.chatId?.startsWith('dm:') ? 'private' : 'squad');
    const id = newId();
    const r = emptyResult(id, input, t, deps.demo ?? false, visibility);
    runs.set(id, r);
    if (runs.size > KEEP) runs.delete(runs.keys().next().value as string);

    const done = (async (): Promise<CouncilResult> => {
      try {
        await runAskCouncil(
          {
            llm: deps.llm,
            emit: deps.emit,
            ...(deps.brain ? { brain: deps.brain } : {}),
            courseId: input.courseId ?? course(),
            now,
            limits,
            publish: (x) => {
              try {
                save.run(x.id, JSON.stringify(x), now());
              } catch {
                // persistence is best effort
              }
              notify(x);
            },
          },
          r,
          input,
        );
      } finally {
        active.set(input.askedBy, Math.max(0, (active.get(input.askedBy) ?? 1) - 1));
        if (r.status === 'running') {
          r.status = 'failed';
          r.phase = 'done';
          r.finishedAt = now();
          r.message = 'The council stopped unexpectedly. Try again.';
        }
        try {
          save.run(r.id, JSON.stringify(r), now());
        } catch {
          // best effort
        }
        notify(r);
      }
      return snapshot(r);
    })();
    // a refusal resolves inside the first tick; surface it to subscribers as well
    return { id, result: () => snapshot(r), done };
  }

  function get(id: string): CouncilResult | undefined {
    const mem = runs.get(id);
    if (mem) return snapshot(mem);
    const row = load.get(id) as { json: string } | undefined;
    if (!row) return undefined;
    const parsed = CouncilResultSchema.safeParse(JSON.parse(row.json));
    if (!parsed.success) return undefined;
    // A run that was in flight when the process stopped will never finish.
    return parsed.data.status === 'running'
      ? {
          ...parsed.data,
          status: 'failed',
          phase: 'done',
          message: 'The council stopped before it finished. Try again.',
        }
      : parsed.data;
  }

  return {
    demo: deps.demo ?? false,
    ask,
    get,
    subscribe(id, fn) {
      const cur = get(id);
      if (!cur) return undefined;
      const set = subs.get(id) ?? new Set();
      subs.set(id, set);
      set.add(fn);
      fn(cur);
      return () => {
        set.delete(fn);
        if (set.size === 0) subs.delete(id);
      };
    },
  };
}
