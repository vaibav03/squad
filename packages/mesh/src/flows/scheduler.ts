// Mesh-backed study scheduler. Structurally matches brain's `MeshScheduler` (declared locally:
// mesh must not depend on @squad/brain), so brain's stub can be swapped out at wiring time.
//
// findSlots runs the study flow (PROTOCOL.md step 4) with a coordinator agent. That flow DMs each
// member through their own agent's askConfirm before a slot is scheduled; that is expected.
// Only the chosen slot leaves the mesh; private values never reach this module.
import { HOUR, hourLabel, parseSlot } from './time';
import type { FlowAgent, FlowOutcome } from './types';

type StudentId = string;
export interface Slot {
  start: number;
  end: number;
}
export interface MeshScheduler {
  findSlots(students: StudentId[], durationMin: number): Promise<Slot[]>;
}

type StudyArgs = Parameters<FlowAgent['startStudy']>[0];
export type StudyCoordinator = Pick<FlowAgent, 'startStudy'>;

export interface MeshSchedulerOptions {
  /** The agent that runs startStudy as coordinator, or a factory choosing one per request. */
  coordinator:
    StudyCoordinator | ((students: StudentId[]) => StudyCoordinator | Promise<StudyCoordinator>);
  now?: () => number;
  /** Search window length in days (default 3, clamped to 1..7: PSI is padded to 168 hourly slots). */
  windowDays?: number;
  taskId?: () => string;
  squadId?: string;
}

/**
 * Returns [] (never throws) when: fewer than 2 students, the flow fails (offline/timeout/blocked),
 * the coordinator call itself errors, or there is no common slot and no hybrid. A hybrid
 * (fewest-busy) slot is returned as the single slot.
 */
export function createMeshScheduler(opts: MeshSchedulerOptions): MeshScheduler {
  const now = opts.now ?? Date.now;
  const days = Math.min(7, Math.max(1, Math.floor(opts.windowDays ?? 3)));
  let n = 0;
  const nextId = opts.taskId ?? (() => `sched_${++n}`);
  return {
    async findSlots(students, durationMin) {
      const members = [...new Set(students)];
      if (members.length < 2 || !(durationMin > 0)) return [];
      const from = (Math.floor(now() / HOUR) + 1) * HOUR;
      const args: StudyArgs = {
        taskId: nextId(),
        members,
        window: { from: hourLabel(from), to: hourLabel(from + days * 24 * HOUR) },
        ...(opts.squadId ? { squadId: opts.squadId } : {}),
      };
      let out: FlowOutcome;
      try {
        const c =
          typeof opts.coordinator === 'function'
            ? await opts.coordinator(members)
            : opts.coordinator;
        out = await c.startStudy(args);
      } catch {
        return [];
      }
      if (out.flow !== 'study') return [];
      const slot =
        out.status === 'scheduled' ? out.slot : out.status === 'no_slot' ? out.hybrid : null;
      if (!slot) return [];
      const start = parseSlot(slot);
      if (!Number.isFinite(start)) return [];
      return [{ start, end: start + durationMin * 60_000 }];
    },
  };
}

/** Coordinator backed by a remote agent's POST /internal/start/study (apps/agent server). */
export function createHttpCoordinator(o: {
  url: string;
  secret: string;
  fetch?: typeof fetch;
}): StudyCoordinator {
  const f = o.fetch ?? fetch;
  return {
    async startStudy(a) {
      const r = await f(`${o.url.replace(/\/+$/, '')}/internal/start/study`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Nook-Internal': o.secret },
        body: JSON.stringify(a),
      });
      if (!r.ok) throw new Error(`mesh scheduler: coordinator http ${r.status}`);
      return (await r.json()) as FlowOutcome;
    },
  };
}
