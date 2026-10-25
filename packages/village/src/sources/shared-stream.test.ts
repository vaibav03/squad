import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openSharedEventSource,
  permitRunStream,
  type SharedEnv,
  type SharedEventSourceLike,
} from './shared-stream';

// ---- fakes: navigator.locks, BroadcastChannel, EventSource --------------------------------------------------------
type Held = { release: () => void; reject: (e: unknown) => void };
class FakeLocks {
  private held = new Map<string, Held>();
  private queue = new Map<string, (() => void)[]>();
  request(
    name: string,
    opts: { signal?: AbortSignal; steal?: boolean },
    cb: (l: unknown) => unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (this.held.get(name) === h) this.held.delete(name);
          this.next(name);
        };
        const h: Held = {
          release: () => {
            finish();
            resolve(undefined);
          },
          reject: (e) => {
            finish();
            reject(e);
          },
        };
        this.held.set(name, h);
        Promise.resolve(cb({}))
          .then(() => h.release())
          .catch((e) => h.reject(e));
      };
      if (opts.steal) {
        const cur = this.held.get(name);
        this.held.delete(name);
        cur?.reject(new DOMException('stolen', 'AbortError'));
        return grant();
      }
      if (!this.held.has(name)) return grant();
      const q = this.queue.get(name) ?? [];
      this.queue.set(name, q);
      const entry = grant;
      q.push(entry);
      opts.signal?.addEventListener('abort', () => {
        const i = q.indexOf(entry);
        if (i >= 0) {
          q.splice(i, 1);
          reject(new DOMException('aborted', 'AbortError'));
        }
      });
    });
  }
  private next(name: string) {
    const q = this.queue.get(name);
    const n = q?.shift();
    if (n) queueMicrotask(n);
  }
  /** A crashed tab: its lock disappears without anyone releasing it. */
  crash(name: string) {
    this.held.get(name)?.release();
  }
}

const buses = new Map<string, Set<FakeBus>>();
class FakeBus {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(private name: string) {
    const s = buses.get(name) ?? new Set();
    buses.set(name, s);
    s.add(this);
  }
  postMessage(m: unknown) {
    const copy = JSON.parse(JSON.stringify(m));
    for (const b of buses.get(this.name) ?? [])
      if (b !== this) queueMicrotask(() => b.onmessage?.({ data: copy }));
  }
  close() {
    buses.get(this.name)?.delete(this);
  }
}

const sources: FakeES[] = [];
class FakeES {
  readyState = 0;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    sources.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(ch: string, event: string, data: unknown, id?: number) {
    this.onmessage?.({
      data: JSON.stringify({ ch, event, ...(id !== undefined ? { id } : {}), data }),
    });
  }
  hello(cursor: { squad?: number; chat?: number }) {
    this.emit('sys', 'hello', { cursor });
  }
  fail(hard: boolean) {
    if (hard) this.readyState = 2;
    this.onerror?.({});
  }
}
const live = () => sources.filter((s) => !s.closed);

const st = (sub: string) =>
  `${Buffer.from(JSON.stringify({ k: 'stream', sub })).toString('base64url')}.sig`;
const URL_SQUAD = (sub: string, extra = '') =>
  `http://hub.test/v1/squad/stream?st=${st(sub)}${extra}`;
const URL_CHAT = (sub: string, extra = '') =>
  `http://hub.test/v1/chat/stream?st=${st(sub)}${extra}`;

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
};

let locks: FakeLocks;
let n = 0;
function tab(over: Partial<SharedEnv> & { hidden?: boolean } = {}) {
  const doc = {
    hidden: over.hidden ?? false,
    handlers: new Set<() => void>(),
    addEventListener(_t: string, fn: () => void) {
      this.handlers.add(fn);
    },
    removeEventListener(_t: string, fn: () => void) {
      this.handlers.delete(fn);
    },
    setHidden(h: boolean) {
      this.hidden = h;
      for (const fn of [...this.handlers]) fn();
    },
  };
  const env: SharedEnv = {
    locks: locks as never,
    Bus: FakeBus as never,
    ES: FakeES as never,
    doc,
    win: null,
    tabId: `t${++n}`,
    registry: new Map(),
    stealDelayMs: 10,
    ...over,
  };
  delete (env as { hidden?: boolean }).hidden;
  const open = (url: string) => openSharedEventSource(url, env);
  return { env, doc, open };
}
const collect = (src: SharedEventSourceLike, ...types: string[]) => {
  const got: { type: string; data: unknown; id: string }[] = [];
  for (const t of types)
    src.addEventListener(t, (e) =>
      got.push({ type: t, data: JSON.parse(e.data), id: e.lastEventId }),
    );
  return got;
};

beforeEach(() => {
  vi.useFakeTimers();
  sources.length = 0;
  buses.clear();
  locks = new FakeLocks();
});
afterEach(() => vi.useRealTimers());

describe('shared stream: one hub connection for many tabs', () => {
  it('N tabs and both channels share a single multiplexed connection', async () => {
    const tabs = [tab(), tab(), tab(), tab()];
    const subs = tabs.flatMap((t) => [t.open(URL_SQUAD('ana')), t.open(URL_CHAT('ana'))]);
    await flush();
    expect(live()).toHaveLength(1);
    expect(live()[0]?.url).toMatch(/^http:\/\/hub\.test\/v1\/stream\?st=/);
    live()[0]?.open();
    await flush();
    expect(subs.every((s) => s.readyState === 1)).toBe(true);
  });

  it('rebroadcasts squad and chat frames to every tab, in order', async () => {
    const a = tab();
    const b = tab();
    const sa = a.open(URL_SQUAD('ana'));
    const cb = b.open(URL_CHAT('ana'));
    const sb = b.open(URL_SQUAD('ana'));
    const gotA = collect(sa, 'agent.state');
    const gotB = collect(sb, 'agent.state');
    const chat = collect(cb, 'chat.message', 'chat.typing');
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    es.hello({ squad: 0, chat: 0 });
    es.emit('squad', 'agent.state', { t: 'agent.state', agent: 'x' }, 1);
    es.emit('chat', 'chat.message', { seq: 1, text: 'hi' }, 1);
    es.emit('chat', 'chat.typing', { on: true });
    es.emit('squad', 'agent.state', { t: 'agent.state', agent: 'y' }, 2);
    await flush();
    expect(gotA.map((g) => g.id)).toEqual(['1', '2']);
    expect(gotB.map((g) => g.id)).toEqual(['1', '2']);
    expect(chat.map((c) => c.type)).toEqual(['chat.message', 'chat.typing']);
  });

  it('never delivers one viewer an event addressed to the squad channel of another scope', async () => {
    const a = tab();
    const b = tab();
    const ana = a.open(URL_SQUAD('ana'));
    const ben = b.open(URL_SQUAD('ben'));
    const gotAna = collect(ana, 'agent.state');
    const gotBen = collect(ben, 'agent.state');
    await flush();
    // two viewers never share a leader: two scopes, two connections
    expect(live()).toHaveLength(2);
    const [first] = live();
    first?.open();
    first?.emit('squad', 'agent.state', { t: 'agent.state', agent: 'a' }, 1);
    await flush();
    expect(gotAna.length + gotBen.length).toBe(1);
  });

  it('on leader exit another tab takes over and resumes from its cursor without loss or duplicates', async () => {
    const a = tab();
    const b = tab();
    const sa = a.open(URL_SQUAD('ana'));
    const sb = b.open(URL_SQUAD('ana'));
    const gotB = collect(sb, 'agent.state');
    await flush();
    const es1 = live()[0] as FakeES;
    es1.open();
    es1.hello({ squad: 0 });
    es1.emit('squad', 'agent.state', { n: 1 }, 1);
    es1.emit('squad', 'agent.state', { n: 2 }, 2);
    await flush();
    expect(gotB.map((g) => g.id)).toEqual(['1', '2']);
    sa.close(); // the leader tab is closed
    await flush();
    expect(es1.closed).toBe(true);
    const es2 = live()[0] as FakeES;
    expect(es2).toBeDefined();
    expect(es2).not.toBe(es1);
    expect(new URL(es2.url).searchParams.get('squadLast')).toBe('2');
    es2.open();
    // the hub replays from the cursor, plus one new event
    es2.emit('squad', 'agent.state', { n: 2 }, 2);
    es2.emit('squad', 'agent.state', { n: 3 }, 3);
    await flush();
    expect(gotB.map((g) => g.id)).toEqual(['1', '2', '3']);
    expect(live()).toHaveLength(1);
  });

  it('survives a leader that crashes (lock vanishes) and keeps one connection', async () => {
    const a = tab();
    const b = tab();
    a.open(URL_SQUAD('ana'));
    const sb = b.open(URL_SQUAD('ana'));
    const got = collect(sb, 'agent.state');
    await flush();
    const es1 = live()[0] as FakeES;
    es1.open();
    es1.emit('squad', 'agent.state', { n: 1 }, 1);
    await flush();
    es1.close(); // the crashed tab's socket dies with it
    locks.crash('squad-stream:http://hub.test|ana');
    await flush();
    const es2 = live()[0] as FakeES;
    expect(es2).toBeDefined();
    es2.open();
    es2.emit('squad', 'agent.state', { n: 2 }, 2);
    await flush();
    expect(got.map((g) => g.id)).toEqual(['1', '2']);
  });

  it('a late tab catches up from the leader buffer; one older than the buffer is told to resync', async () => {
    const a = tab({ bufferSize: 3 });
    a.open(URL_SQUAD('ana'));
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    es.hello({ squad: 0 });
    for (let i = 1; i <= 5; i++) es.emit('squad', 'agent.state', { n: i }, i);
    await flush();
    // buffer holds 3,4,5 (cover = 2)
    const b = tab();
    const late = b.open(URL_SQUAD('ana', '&lastEventId=3'));
    const gotLate = collect(late, 'agent.state', 'x.resync');
    const older = b.open(URL_SQUAD('ana', '&lastEventId=0'));
    const gotOlder = collect(older, 'agent.state', 'x.resync');
    await flush();
    expect(gotLate.map((g) => [g.type, g.id])).toEqual([
      ['agent.state', '4'],
      ['agent.state', '5'],
    ]);
    expect(gotOlder.map((g) => g.type)).toEqual(['x.resync']);
    expect(live()).toHaveLength(1);
  });

  it('a tab that joins late and resumes from a snapshot seq loses nothing around it', async () => {
    const a = tab();
    a.open(URL_SQUAD('ana'));
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    es.hello({ squad: 10 });
    es.emit('squad', 'agent.state', { n: 11 }, 11);
    es.emit('squad', 'agent.state', { n: 12 }, 12);
    await flush();
    const b = tab();
    const sb = b.open(URL_SQUAD('ana', '&lastEventId=11')); // its snapshot was taken at seq 11
    const got = collect(sb, 'agent.state');
    await flush();
    es.emit('squad', 'agent.state', { n: 13 }, 13);
    await flush();
    expect(got.map((g) => g.id)).toEqual(['12', '13']);
  });

  it('filters by taskId on the client like the legacy stream did', async () => {
    const a = tab();
    const s = a.open(URL_SQUAD('ana', '&taskId=t1'));
    const got = collect(s, 'trip.update');
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    es.emit('squad', 'trip.update', { taskId: 't1' }, 1);
    es.emit('squad', 'trip.update', { taskId: 't2' }, 2);
    es.emit('squad', 'trip.update', { other: true }, 3);
    await flush();
    expect(got.map((g) => g.id)).toEqual(['1', '3']);
  });

  it('a refused stream (stale token) errors the consumers; a fresh token from any tab reconnects', async () => {
    const a = tab();
    const b = tab();
    const sa = a.open(URL_SQUAD('ana'));
    const sb = b.open(URL_SQUAD('ana'));
    const onerrA = vi.fn();
    const onerrB = vi.fn();
    sa.onerror = onerrA;
    sb.onerror = onerrB;
    await flush();
    const es1 = live()[0] as FakeES;
    es1.fail(true);
    await flush();
    expect(onerrA).toHaveBeenCalled();
    expect(onerrB).toHaveBeenCalled();
    expect(sa.readyState).toBe(2);
    // the consumer mints a new stream token and subscribes again
    b.open(`http://hub.test/v1/squad/stream?st=${st('ana')}x`);
    await flush();
    expect(live()).toHaveLength(1);
    expect(live()[0]).not.toBe(es1);
    expect(new URL((live()[0] as FakeES).url).searchParams.get('st')).toMatch(/x$/);
  });

  it('reconnect noise: a dropped connection tells consumers once and open again after', async () => {
    const a = tab();
    const s = a.open(URL_SQUAD('ana'));
    const opens = vi.fn();
    const errs = vi.fn();
    s.onopen = opens;
    s.onerror = errs;
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    await flush();
    es.fail(false);
    es.open();
    await flush();
    expect(opens).toHaveBeenCalledTimes(2);
    expect(errs).toHaveBeenCalledTimes(1);
    expect(s.readyState).toBe(1);
  });

  it('the leader reconnects when the heartbeat stops', async () => {
    const a = tab({ stallMs: 5000 });
    a.open(URL_SQUAD('ana'));
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    es.emit('squad', 'agent.state', {}, 4);
    await vi.advanceTimersByTimeAsync(7000);
    expect(es.closed).toBe(true);
    const next = live()[0] as FakeES;
    expect(new URL(next.url).searchParams.get('squadLast')).toBe('4');
  });

  it('a hidden leader hands the lock to a visible tab; the old connection closes', async () => {
    const a = tab();
    const b = tab();
    const sa = a.open(URL_SQUAD('ana'));
    const sb = b.open(URL_SQUAD('ana'));
    const got = collect(sb, 'agent.state');
    collect(sa, 'agent.state');
    await flush();
    const es1 = live()[0] as FakeES;
    es1.open();
    es1.emit('squad', 'agent.state', {}, 1);
    await flush();
    a.doc.setHidden(true);
    await vi.advanceTimersByTimeAsync(500);
    await flush();
    expect(es1.closed).toBe(true);
    const es2 = live()[0] as FakeES;
    expect(es2).toBeDefined();
    expect(live()).toHaveLength(1);
    es2.open();
    es2.emit('squad', 'agent.state', {}, 2);
    await flush();
    expect(got.map((g) => g.id)).toEqual(['1', '2']);
    // the visible leader is not stolen back
    a.doc.setHidden(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(live()).toHaveLength(1);
    expect(es2.closed).toBe(false);
  });

  it('keeps the single stream when every tab is hidden', async () => {
    const a = tab({ hidden: true });
    const b = tab({ hidden: true });
    a.open(URL_SQUAD('ana'));
    b.open(URL_SQUAD('ana'));
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(live()).toHaveLength(1);
  });

  it('falls back to one multiplexed connection per tab where Web Locks is unavailable', async () => {
    const a = tab({ locks: null });
    const b = tab({ locks: null });
    const sa = a.open(URL_SQUAD('ana'));
    a.open(URL_CHAT('ana'));
    b.open(URL_SQUAD('ana'));
    const got = collect(sa, 'agent.state');
    await flush();
    expect(live()).toHaveLength(2); // one per tab, never one per channel
    for (const s of live()) expect(s.url).toContain('/v1/stream?');
    const es = live()[0] as FakeES;
    es.open();
    es.emit('squad', 'agent.state', {}, 1);
    await flush();
    expect(got).toHaveLength(1);
    expect(sa.readyState).toBe(1);
  });

  it('falls back the same way without BroadcastChannel', async () => {
    const a = tab({ Bus: null });
    const b = tab({ Bus: null });
    a.open(URL_SQUAD('ana'));
    b.open(URL_SQUAD('ana'));
    await flush();
    expect(live()).toHaveLength(2);
  });

  it('closing the last consumer closes the connection and leaves the queue', async () => {
    const a = tab();
    const s1 = a.open(URL_SQUAD('ana'));
    const s2 = a.open(URL_CHAT('ana'));
    await flush();
    const es = live()[0] as FakeES;
    s1.close();
    await flush();
    expect(es.closed).toBe(false);
    s2.close();
    await flush();
    expect(es.closed).toBe(true);
  });

  it('a throwing consumer never stops delivery', async () => {
    const a = tab();
    const s = a.open(URL_SQUAD('ana'));
    s.addEventListener('agent.state', () => {
      throw new Error('boom');
    });
    const got = collect(s, 'agent.state');
    await flush();
    const es = live()[0] as FakeES;
    es.open();
    es.emit('squad', 'agent.state', {}, 1);
    await flush();
    expect(got).toHaveLength(1);
  });
});

describe('permitRunStream: one per-run stream per browser', () => {
  it('queues a second run behind the first and releases on close', async () => {
    const opened: string[] = [];
    const mk = (name: string) => () => {
      opened.push(name);
      return {
        close: vi.fn(),
        onerror: null as ((e: never) => void) | null,
        addEventListener: vi.fn(),
      };
    };
    const first = permitRunStream(mk('a'), { locks: locks as never });
    const second = permitRunStream(mk('b'), { locks: locks as never });
    await flush();
    expect(opened).toEqual(['a']);
    first.close();
    await flush();
    expect(opened).toEqual(['a', 'b']);
    second.close();
  });

  it('a run that never gets a turn reports a stream error so its caller falls back to polling', async () => {
    const hold = permitRunStream(
      () => ({ close() {}, onerror: null as ((e: never) => void) | null, addEventListener() {} }),
      {
        locks: locks as never,
      },
    );
    const waiter = permitRunStream(
      () => ({ close() {}, onerror: null as ((e: never) => void) | null, addEventListener() {} }),
      {
        locks: locks as never,
      },
    );
    const err = vi.fn();
    waiter.onerror = err;
    await flush();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(err).toHaveBeenCalled();
    hold.close();
  });

  it('opens immediately without Web Locks', () => {
    const open = vi.fn(() => ({ close() {}, onerror: null }));
    permitRunStream(open, { locks: null });
    expect(open).toHaveBeenCalled();
  });
});
