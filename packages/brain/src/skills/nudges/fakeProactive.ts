// A minimal in-memory ProactiveApi for skill unit tests in this package (no cron, no delivery pipeline).
// The real durable implementation and its tests live in apps/bot/src/scheduler.
import type {
  JobFilter,
  JobHandler,
  JobRecord,
  PrefsView,
  ProactiveApi,
  ScheduleSpec,
} from './api';

export interface FakeProactive extends ProactiveApi {
  jobs: JobRecord[];
  handlers: Map<string, JobHandler>;
  setNow(ms: number): void;
}

export function createFakeProactive(startMs = 1_700_000_000_000): FakeProactive {
  let clock = startMs;
  let seq = 0;
  const jobs: JobRecord[] = [];
  const handlers = new Map<string, JobHandler>();
  const prefs = new Map<string, PrefsView>();
  const listeners: ((s: string, p: PrefsView) => void)[] = [];
  const view = (s: string): PrefsView =>
    prefs.get(s) ?? {
      optIn: false,
      optedOut: false,
      tz: 'UTC',
      quiet: { start: '22:00', end: '08:00' },
    };
  const match = (j: JobRecord, f: JobFilter) =>
    (!f.student || j.student === f.student) &&
    (!f.kind || j.kind === f.kind) &&
    (!f.kindPrefix || j.kind.startsWith(f.kindPrefix)) &&
    (!f.status || [f.status].flat().includes(j.status));
  const api: FakeProactive = {
    jobs,
    handlers,
    setNow: (ms) => void (clock = ms),
    now: () => clock,
    register: (k, h) => void handlers.set(k, h),
    schedule(spec: ScheduleSpec) {
      const hit = jobs.find((j) => j.key === spec.key && j.status !== 'cancelled');
      if (hit) return hit;
      const j: JobRecord = {
        id: ++seq,
        key: spec.key,
        kind: spec.kind,
        payload: spec.payload ?? null,
        ...(spec.student ? { student: spec.student } : {}),
        ...(spec.chatId ? { chatId: spec.chatId } : {}),
        scope: spec.scope ?? 'dm',
        ...(spec.cron ? { cron: spec.cron } : {}),
        ...(spec.tz ? { tz: spec.tz } : {}),
        runAt: spec.runAt ?? clock,
        status: 'pending',
        attempts: 0,
        maxAttempts: spec.maxAttempts ?? 3,
        missed: spec.missed ?? 'run_once',
        graceMs: spec.graceMs ?? 6 * 3_600_000,
        requiresOptIn: spec.requiresOptIn ?? false,
        createdAt: clock,
      };
      jobs.push(j);
      return j;
    },
    cancel(key) {
      const j = jobs.find((x) => x.key === key && x.status === 'pending');
      if (!j) return false;
      j.status = 'cancelled';
      return true;
    },
    cancelWhere(f) {
      let n = 0;
      for (const j of jobs)
        if (j.status === 'pending' && match(j, f)) ((j.status = 'cancelled'), n++);
      return n;
    },
    list: (f = {}) => jobs.filter((j) => match(j, f)),
    get: (key) => jobs.find((j) => j.key === key && j.status !== 'cancelled'),
    prefs: view,
    setPrefs(s, patch) {
      const cur = view(s);
      const { snoozeUntil, ...rest } = patch;
      const next: PrefsView = { ...cur, ...rest };
      if (snoozeUntil === null) delete next.snoozeUntil;
      else if (snoozeUntil !== undefined) next.snoozeUntil = snoozeUntil;
      prefs.set(s, next);
      for (const l of listeners) l(s, next);
      return next;
    },
    kick() {},
    onPrefsChange: (fn) => void listeners.push(fn),
  };
  return api;
}
