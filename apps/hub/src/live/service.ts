import { LiveRun, type EngineDeps, type LiveRunInit } from './engine';
import { livePersonasFromEnv } from './env';

export class LiveBusyError extends Error {
  override readonly name = 'LiveBusyError';
  constructor(readonly code: 'busy' | 'rate_limited') {
    super(code);
  }
}

export interface LiveStartInput {
  topic: string;
  askedBy: string;
  squadId: string;
  chatId?: string;
  visibility: 'squad' | 'private';
  mode?: 'audio' | 'captions';
  personas?: LiveRunInit['personas'];
}

export interface LiveService {
  start(i: LiveStartInput): LiveRun;
  get(id: string): LiveRun | undefined;
}

const KEEP = 100;
const HOUR = 3_600_000;

function randomId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `ld_${Array.from(bytes, (b) => (b % 36).toString(36)).join('')}`;
}

/** In-memory runs, the per-viewer budget guard (one active run, N starts per hour). */
export function createLiveService(deps: EngineDeps & { newId?: () => string }): LiveService {
  const runs = new Map<string, LiveRun>();
  const active = new Map<string, number>();
  const history = new Map<string, number[]>();
  const newId = deps.newId ?? randomId;
  return {
    start(i) {
      const t = deps.now();
      if ((active.get(i.askedBy) ?? 0) >= deps.limits.maxActivePerUser)
        throw new LiveBusyError('busy');
      const recent = (history.get(i.askedBy) ?? []).filter((x) => t - x < HOUR);
      if (recent.length >= deps.limits.startsPerHour) throw new LiveBusyError('rate_limited');
      history.set(i.askedBy, [...recent, t]);
      active.set(i.askedBy, (active.get(i.askedBy) ?? 0) + 1);
      const run = new LiveRun(deps, {
        id: newId(),
        topic: i.topic,
        askedBy: i.askedBy,
        squadId: i.squadId,
        ...(i.chatId ? { chatId: i.chatId } : {}),
        visibility: i.visibility,
        mode: i.mode ?? 'audio',
        ...((i.personas ?? livePersonasFromEnv())
          ? { personas: (i.personas ?? livePersonasFromEnv()) as NonNullable<typeof i.personas> }
          : {}),
      });
      runs.set(run.id, run);
      if (runs.size > KEEP) runs.delete(runs.keys().next().value as string);
      void run
        .settled()
        .finally(() => active.set(i.askedBy, Math.max(0, (active.get(i.askedBy) ?? 1) - 1)));
      return run;
    },
    get: (id) => runs.get(id),
  };
}
