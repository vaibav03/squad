import type { EventLog, LoggedEvent } from '../types';

/** Ring buffer with monotonic integer seq (starts at 1). Memory is bounded by `max`. */
export function createEventLog(opts: { max: number }): EventLog {
  const max = Math.max(1, opts.max);
  let buf: LoggedEvent[] = [];
  let head = 0; // index of the oldest element when full
  let seq = 0;
  let evicted = false;
  const ordered = (): LoggedEvent[] =>
    buf.length < max ? buf : [...buf.slice(head), ...buf.slice(0, head)];

  return {
    append(e) {
      const logged: LoggedEvent = { ...e, seq: ++seq, ts: Date.now() };
      if (buf.length < max) buf.push(logged);
      else {
        buf[head] = logged;
        head = (head + 1) % max;
        evicted = true;
      }
      return logged;
    },
    since(afterSeq) {
      const all = ordered();
      const oldest = all[0]?.seq ?? seq + 1;
      if (afterSeq > 0 && evicted && afterSeq < oldest - 1) return 'too_old';
      return all.filter((e) => e.seq > afterSeq);
    },
    lastSeq: () => seq,
    size: () => buf.length,
    clear() {
      buf = [];
      head = 0;
      evicted = false; // seq keeps counting so ids never repeat after a reset
    },
  };
}
