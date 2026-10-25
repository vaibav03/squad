import { filterEvent } from './filter';
import type { Broker, HubDeps, LoggedEvent, Subscription, Viewer, WireEvent } from './types';

type Item = WireEvent | { resync: number };

class Sub implements Subscription {
  private queue: Item[] = [];
  private waiter: ((r: IteratorResult<Item>) => void) | null = null;
  private closed = false;
  limit: number;

  constructor(
    readonly viewer: Viewer,
    readonly taskId: string | undefined,
    limit: number,
    private readonly onClose: (s: Sub) => void,
  ) {
    this.limit = limit;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Returns false when the subscriber overflowed and was closed (a stalled client is dropped, never buffered). */
  push(item: Item): boolean {
    if (this.closed) return false;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: item, done: false });
      return true;
    }
    if (this.queue.length >= this.limit) {
      this.close();
      return false;
    }
    this.queue.push(item);
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.onClose(this);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined, done: true });
    }
  }

  readonly events: AsyncIterable<Item> = {
    [Symbol.asyncIterator]: () => ({
      next: (): Promise<IteratorResult<Item>> => {
        const v = this.queue.shift();
        if (v !== undefined) return Promise.resolve({ value: v, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
      return: (): Promise<IteratorResult<Item>> => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    }),
  };
}

const payloadTaskId = (e: LoggedEvent): string | undefined => {
  const p = e.payload as { taskId?: unknown } | null;
  return typeof p?.taskId === 'string' ? p.taskId : undefined;
};

export function createBroker(deps: HubDeps): Broker {
  const subs = new Set<Sub>();

  const deliver = (s: Sub, e: LoggedEvent): boolean => {
    if (s.taskId) {
      const t = payloadTaskId(e);
      if (t !== undefined && t !== s.taskId) return true;
    }
    const wire = filterEvent(e, s.viewer, deps.filterCtx);
    return wire ? s.push(wire) : true;
  };

  return {
    publish(e) {
      for (const s of [...subs]) {
        if (!deliver(s, e))
          deps.log.warn('sse subscriber dropped: queue overflow', { squadId: s.viewer.squadId });
      }
    },
    subscribe(viewer, opts) {
      const sub = new Sub(viewer, opts.taskId, deps.config.sse.maxQueue, (s) => subs.delete(s));
      // Backlog and live registration happen synchronously, so there is no gap and no duplicate.
      if (opts.afterSeq !== undefined) {
        const backlog = deps.events.since(opts.afterSeq);
        if (backlog === 'too_old') sub.push({ resync: deps.events.lastSeq() });
        else {
          sub.limit = deps.config.sse.maxQueue + backlog.length;
          for (const e of backlog) deliver(sub, e);
        }
      }
      if (!sub.isClosed) subs.add(sub);
      return sub;
    },
    count: () => subs.size,
    closeAll() {
      for (const s of [...subs]) s.close();
    },
  };
}
