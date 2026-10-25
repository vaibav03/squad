// Deterministic scripted run: fixed seeds, fixtures, ordering and pacing; no LLM text, no clock, no network.
// Same input => byte-identical replay JSON (validated against @squad/core's ReplayScriptSchema).
import { parseReplay, type ReplayScript, type VillageEvent } from '@squad/core';
import { TRIP_OPTIONS, WINDOWS, createTestMesh, type MeshOptions } from '../flows';

export type ScriptedFlow = 'study' | 'trip' | 'query' | 'all';

export interface ScriptedOptions {
  flow?: ScriptedFlow;
  seed?: string;
  name?: string;
  me?: string;
  /** Override who answers no / timeout (default: everybody says yes). */
  answers?: MeshOptions['answers'];
}

const MEMBERS = ['s_ana', 's_ben', 's_chi', 's_dev'];

/** Milliseconds a viewer needs to follow each kind of event (pacing is part of the script, never wall time). */
function gap(e: VillageEvent): number {
  switch (e.t) {
    case 'ledger.entry':
      return 120;
    case 'agent.state':
      return 180;
    case 'confirm.pending':
      return 1400;
    case 'confirm.done':
      return 700;
    case 'trip.confirmed':
      return 2600;
    case 'agent.message':
      return e.kind === 'option_dropped' || e.kind === 'conflict' || e.kind === 'query_denied'
        ? 1600
        : 420;
    default:
      return 300;
  }
}

export interface ScriptedResult {
  script: ReplayScript;
  json: string; // canonical bytes written to disk
  outcomes: Record<string, unknown>;
}

export async function runScripted(opts: ScriptedOptions = {}): Promise<ScriptedResult> {
  const flow = opts.flow ?? 'all';
  const seed = opts.seed ?? 'squad-scripted-v1';
  const mesh = createTestMesh({ seed, ...(opts.answers ? { answers: opts.answers } : {}) });
  const ana = mesh.agents.s_ana!;
  const marks: Record<string, number> = {};
  const outcomes: Record<string, unknown> = {};
  const mark = (name: string): void => {
    marks[name] ??= mesh.emitter.events.length;
  };

  if (flow === 'study' || flow === 'all') {
    mark('study');
    outcomes.study = await ana.startStudy({
      taskId: 'task_study_1',
      members: MEMBERS,
      window: WINDOWS.study,
      topics: ['dynamic-programming', 'graphs'],
      squadId: 'squad_1',
    });
  }
  if (flow === 'trip' || flow === 'all') {
    mark('trip');
    outcomes.trip = await ana.startTrip({
      taskId: 'task_trip_1',
      members: MEMBERS,
      window: WINDOWS.trip,
      options: TRIP_OPTIONS,
      squadId: 'squad_1',
    });
  }
  if (flow === 'query' || flow === 'all') {
    mark('query');
    outcomes.query = await mesh.agents.s_ben!.askPeer('budget', 's_ana', 'task_query_1');
  }

  let at = 0;
  const events = mesh.emitter.events.map((event) => {
    at += gap(event);
    return { at, event };
  });
  const atIndex = (i: number): number =>
    i <= 0 ? 0 : (events[Math.min(i, events.length) - 1]?.at ?? 0);
  const checkpoints: Record<string, number> = {};
  for (const [k, i] of Object.entries(marks)) checkpoints[k] = atIndex(i);
  const firstAt = (pred: (e: VillageEvent) => boolean): number | undefined =>
    events.find((x) => pred(x.event))?.at;
  const drop = firstAt((e) => e.t === 'agent.message' && e.kind === 'option_dropped');
  if (drop !== undefined) checkpoints.option_dropped = drop;
  const pend = firstAt((e) => e.t === 'confirm.pending');
  if (pend !== undefined) checkpoints.confirm = pend;
  const done = firstAt((e) => e.t === 'trip.confirmed');
  if (done !== undefined) checkpoints.trip_confirmed = done;
  const denied = firstAt((e) => e.t === 'agent.message' && e.kind === 'query_denied');
  if (denied !== undefined) checkpoints.query_denied = denied;

  const me = opts.me ?? 's_ana';
  const script = parseReplay({
    name: opts.name ?? `mesh-${flow}`,
    version: 1,
    loop: false,
    cast: { me, s_ana: 'Ana', s_ben: 'Ben', s_chi: 'Chi', s_dev: 'Dev' },
    events,
    checkpoints,
  });
  return { script, json: `${JSON.stringify(script, null, 2)}\n`, outcomes };
}
