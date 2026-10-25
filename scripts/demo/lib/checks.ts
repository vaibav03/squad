/** Pure preflight checks. Each returns a CheckResult; nothing here touches the network, disk or process. */
import {
  SENTINELS,
  VILLAGE_EVENT_TYPES,
  findLeak,
  validateReplay,
  type ReplayScript,
} from '@squad/core';

export type Status = 'PASS' | 'WARN' | 'FAIL';
export interface CheckResult {
  id: string;
  status: Status;
  message: string;
  /** One-line fix, shown for WARN and FAIL. */
  fix?: string;
}

const pass = (id: string, message: string): CheckResult => ({ id, status: 'PASS', message });
const warn = (id: string, message: string, fix: string): CheckResult => ({
  id,
  status: 'WARN',
  message,
  fix,
});
const fail = (id: string, message: string, fix: string): CheckResult => ({
  id,
  status: 'FAIL',
  message,
  fix,
});
/** WARN normally, FAIL when the run is live. */
const soft = (live: boolean, id: string, message: string, fix: string): CheckResult =>
  live ? fail(id, message, fix) : warn(id, message, fix);

export function checkNode(version: string, minMajor = 20): CheckResult {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? NaN);
  return major >= minMajor
    ? pass('node', `Node ${version}`)
    : fail(
        'node',
        `Node ${version} is older than ${minMajor}`,
        `install Node ${minMajor}+ (see .nvmrc)`,
      );
}

export function checkEnvFile(exists: boolean): CheckResult {
  return exists
    ? pass('env-file', '.env exists')
    : warn(
        'env-file',
        '.env is missing',
        'cp .env.example .env and fill in the keys (replay needs none)',
      );
}

export function checkSecret(value: string | undefined, live = false): CheckResult {
  if (!value)
    return soft(
      live,
      'internal-secret',
      'INTERNAL_EVENTS_SECRET is not set',
      'set INTERNAL_EVENTS_SECRET in .env to a random string',
    );
  if (value === 'change-me')
    return warn(
      'internal-secret',
      'INTERNAL_EVENTS_SECRET is still the default change-me',
      'set a random INTERNAL_EVENTS_SECRET in .env before exposing the hub (fine on localhost)',
    );
  return pass('internal-secret', 'INTERNAL_EVENTS_SECRET is set');
}

/** Reports only set/missing, never the value or its length. */
export function checkKey(name: string, value: string | undefined, live: boolean): CheckResult {
  const id = `key-${name.toLowerCase()}`;
  return value && value.trim() !== ''
    ? pass(id, `${name} set`)
    : soft(live, id, `${name} missing`, `add ${name} to .env (replay mode does not need it)`);
}

export function checkHub(
  health: { ok: boolean; error?: string },
  baseUrl: string,
  live: boolean,
): CheckResult {
  return health.ok
    ? pass('hub-health', `hub healthy at ${baseUrl}`)
    : soft(
        live,
        'hub-health',
        `hub not reachable at ${baseUrl} (${health.error ?? 'no response'})`,
        'run pnpm --filter @squad/hub start (pnpm demo:replay starts it for you)',
      );
}

export function checkReplayValid(
  name: string,
  input: unknown,
): { result: CheckResult; script?: ReplayScript } {
  const v = validateReplay(input);
  if (v.ok)
    return {
      result: pass(`replay-${name}`, `${name}: valid (${v.script.events.length} events)`),
      script: v.script,
    };
  return {
    result: fail(
      `replay-${name}`,
      `${name}: invalid: ${v.errors.slice(0, 3).join('; ')}${v.errors.length > 3 ? ` (+${v.errors.length - 3} more)` : ''}`,
      `fix apps/hub/sim/replays/${name}.json (the zod paths above name the fields)`,
    ),
  };
}

export function checkEventCoverage(scripts: readonly ReplayScript[]): CheckResult {
  const seen = new Set(scripts.flatMap((s) => s.events.map((e) => e.event.t)));
  const missing = VILLAGE_EVENT_TYPES.filter((t) => !seen.has(t));
  return missing.length === 0
    ? pass(
        'event-coverage',
        `all ${VILLAGE_EVENT_TYPES.length} event types appear across the replays`,
      )
    : fail(
        'event-coverage',
        `event types missing from the replays: ${missing.join(', ')}`,
        'add at least one event of each missing type to track2.json or track3.json',
      );
}

export function checkCastMe(script: ReplayScript): CheckResult {
  const id = `cast-${script.name}`;
  return script.cast.me
    ? pass(id, `${script.name}: cast.me = ${script.cast.me}`)
    : fail(id, `${script.name}: cast.me missing`, 'set cast.me to the viewing student id');
}

/** Track 2 must end on trip.confirmed, with the checkpoint `before-last-confirm` strictly before the final confirm.done of that trip. */
export function checkTrack2Shape(script: ReplayScript): CheckResult[] {
  const out: CheckResult[] = [];
  const last = script.events.at(-1)?.event;
  out.push(
    last?.t === 'trip.confirmed'
      ? pass('track2-ending', 'track2 ends on trip.confirmed')
      : fail(
          'track2-ending',
          `track2 ends on ${last?.t ?? 'nothing'}, not trip.confirmed`,
          'make trip.confirmed the last event of track2.json',
        ),
  );
  const tripTask = last?.t === 'trip.confirmed' ? last.taskId : undefined;
  const confirms = script.events.filter(
    (e) => e.event.t === 'confirm.done' && (tripTask === undefined || e.event.taskId === tripTask),
  );
  const finalConfirm = confirms.at(-1);
  const cp = script.checkpoints['before-last-confirm'];
  if (cp === undefined) {
    out.push(
      fail(
        'track2-checkpoint',
        'checkpoint "before-last-confirm" is missing',
        'add checkpoints["before-last-confirm"] just before the last confirm.done',
      ),
    );
  } else if (!finalConfirm) {
    out.push(
      fail(
        'track2-checkpoint',
        'no confirm.done event for the trip task',
        'the last student tap must be a confirm.done on the trip task',
      ),
    );
  } else if (cp < finalConfirm.at) {
    out.push(
      pass(
        'track2-checkpoint',
        `checkpoint before-last-confirm (${cp}ms) precedes the final confirm.done (${finalConfirm.at}ms)`,
      ),
    );
  } else {
    out.push(
      fail(
        'track2-checkpoint',
        `checkpoint before-last-confirm (${cp}ms) is not before the final confirm.done (${finalConfirm.at}ms)`,
        'move the checkpoint earlier than the last confirm.done',
      ),
    );
  }
  return out;
}

/** Sentinel scan over any serialisable value. */
export function checkNoLeak(
  label: string,
  value: unknown,
  sentinels: readonly string[] = SENTINELS,
): CheckResult {
  const id = `leak-${label}`;
  const items = Array.isArray(value) ? value : [value];
  for (let i = 0; i < items.length; i++) {
    const s = findLeak(items[i], sentinels);
    if (s) {
      const where = Array.isArray(value) ? `${label}[${i}]` : label;
      return fail(
        id,
        `withheld sentinel "${s}" appears in ${where}`,
        'remove the withheld value from the public output; ledger events carry withheld:"hidden" only',
      );
    }
  }
  return pass(id, `${label}: no sentinel (${sentinels.join(', ')})`);
}

export function checkPlantedSentinels(
  planted: readonly string[],
  sentinels: readonly string[] = SENTINELS,
): CheckResult {
  const missing = sentinels.filter((s) => !planted.includes(s));
  return missing.length === 0
    ? pass('seed-sentinels', `seed plants ${sentinels.join(', ')} in private fields`)
    : fail(
        'seed-sentinels',
        `seed does not plant: ${missing.join(', ')}`,
        'put the sentinel in a private student field or calendar event',
      );
}

export function summarize(results: readonly CheckResult[]): {
  pass: number;
  warn: number;
  fail: number;
  ok: boolean;
} {
  const c = (s: Status) => results.filter((r) => r.status === s).length;
  return { pass: c('PASS'), warn: c('WARN'), fail: c('FAIL'), ok: c('FAIL') === 0 };
}
