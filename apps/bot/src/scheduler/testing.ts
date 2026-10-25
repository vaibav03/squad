import type { Ctx, Db } from '@squad/core';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createScheduler, type RunResult, type Scheduler, type SchedulerConfig } from './scheduler';

/** 2026-10-26 12:00 UTC, a Monday. */
export const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

export interface Sink {
  dms: { to: string; text: string; at: number }[];
  groups: { chatId: string; text: string; at: number }[];
  asks: { student: string; question: string; options: string[]; at: number }[];
}

/**
 * A scheduler on a virtual clock bound to a recording ctx: no transport, no sleeping. `answers` scripts
 * what askConfirm resolves to ('timeout' when the queue is empty).
 */
export function createSchedulerHarness(
  o: { db?: Db; startMs?: number; config?: Partial<SchedulerConfig>; answers?: string[] } = {},
) {
  let clock = o.startMs ?? T0;
  const db = o.db ?? openMemoryDb();
  const sink: Sink = { dms: [], groups: [], asks: [] };
  const answers = [...(o.answers ?? [])];
  const scheduler: Scheduler = createScheduler({ db, now: () => clock, config: o.config });
  const ctx: Ctx = {
    db,
    llm: new FakeLlm({ fallback: 'fake' }),
    send: async (m) => void sink.groups.push({ chatId: m.chatId, text: m.text ?? '', at: clock }),
    dm: async (to, text) => void sink.dms.push({ to, text, at: clock }),
    askConfirm: async (student, question, options) => {
      sink.asks.push({ student, question, options, at: clock });
      return answers.shift() ?? 'timeout';
    },
  };
  scheduler.bind(ctx);
  return {
    db,
    scheduler,
    sink,
    ctx,
    answers,
    now: () => clock,
    set(ms: number) {
      clock = ms;
    },
    /** Advance the virtual clock in `step` increments, ticking at each, like the real loop would. */
    async advance(ms: number, step = 60_000): Promise<RunResult[]> {
      const out: RunResult[] = [];
      const end = clock + ms;
      while (clock < end) {
        clock = Math.min(end, clock + step);
        out.push(...(await scheduler.tick()));
      }
      return out;
    },
  };
}
export type SchedulerHarness = ReturnType<typeof createSchedulerHarness>;
