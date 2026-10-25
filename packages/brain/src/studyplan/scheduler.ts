import type { StudentId } from '@squad/core';

export interface Slot {
  start: number;
  end: number;
}

/** Implemented by mesh (04). Times come from the privacy-preserving scheduler, never from brain. */
export interface MeshScheduler {
  findSlots(students: StudentId[], durationMin: number): Promise<Slot[]>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Deterministic stub until mesh lands: the next three evenings at 19:00 (UTC) after `now`. */
export function createStubScheduler(
  opts: { now?: () => number; slots?: Slot[] } = {},
): MeshScheduler {
  return {
    async findSlots(_students, durationMin) {
      if (opts.slots) return opts.slots;
      const now = (opts.now ?? Date.now)();
      const midnight = Math.floor(now / DAY) * DAY;
      return [1, 2, 3].map((d) => {
        const start = midnight + d * DAY + 19 * HOUR;
        return { start, end: start + durationMin * 60_000 };
      });
    },
  };
}
