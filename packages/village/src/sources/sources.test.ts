import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { VILLAGE_EVENT_TYPES } from '@squad/core';
import type { VillageEvent } from '@squad/core';
import { VILLAGE_SOURCES_ENTRY, createLiveSource, createReplaySource } from './index';
import type { Clock, EventSourceLike } from './index';

class FakeClock implements Clock {
  t = 0;
  q: { at: number; fn: () => void; id: number }[] = [];
  n = 0;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.n;
    this.q.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown) {
    this.q = this.q.filter((x) => x.id !== h);
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.id - b.id);
      const nx = this.q[0];
      if (!nx || nx.at > end) break;
      this.q.shift();
      this.t = nx.at;
      nx.fn();
    }
    this.t = end;
  }
}

const ev = (agent: string, state: 'idle' | 'studying' = 'idle'): VillageEvent => ({
  t: 'agent.state',
  agent,
  state,
});
const script = (over: object = {}) => ({
  name: 't',
  version: 1,
  loop: false,
  cast: { me: 's_ana' },
  events: [
    { at: 0, event: ev('dean', 'studying') },
    { at: 1000, event: ev('dean') },
    { at: 1000, event: ev('student:s_ana') },
    { at: 3000, event: ev('dean', 'studying') },
  ],
  checkpoints: { mid: 1000, end: 3000 },
  ...over,
});

describe('sources are Phaser-free', () => {
  it('no phaser or window at import', () => {
    expect(VILLAGE_SOURCES_ENTRY).toBe(true);
    const dir = new URL('./', import.meta.url);
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.includes('test'))) {
      expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(/from 'phaser'/);
    }
  });
});

describe('ReplaySource hardening', () => {
  it('restart while playing keeps playing from zero', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    const seen: number[] = [];
    r.subscribe(() => seen.push(clock.now()));
    r.play();
    clock.advance(1500);
    r.restart();
    expect(r.status).toBe('playing');
    clock.advance(3000);
    expect(seen).toEqual([0, 1000, 1000, 1500, 2500, 2500, 4500]);
    expect(r.status).toBe('ended');
  });
  it('stops emitting when a subscriber pauses mid-batch', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    let n = 0;
    r.subscribe(() => {
      n++;
      if (n === 2) r.pause();
    });
    r.play();
    clock.advance(1000);
    expect(n).toBe(2);
    expect(r.status).toBe('paused');
    r.play();
    clock.advance(0);
    expect(n).toBe(3);
  });
  it('stops emitting when a subscriber closes or seeks mid-batch', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    let n = 0;
    r.subscribe(() => {
      if (++n === 2) r.close();
    });
    r.play();
    clock.advance(1000);
    expect(n).toBe(2);
    const c2 = new FakeClock();
    const r2 = createReplaySource(script(), { clock: c2 });
    const ids: string[] = [];
    let seeked = false;
    r2.subscribe((_e, m) => {
      ids.push(m?.id ?? '');
      if (!seeked && ids.length === 2) {
        seeked = true;
        r2.seek(0);
      }
    });
    r2.play();
    c2.advance(1000);
    // the batch stops at the seek; playback restarts from 0 and t:1 is due 1000 ms later
    expect(ids).toEqual(['t:0', 't:1', 't:0']);
    c2.advance(1000);
    expect(ids.slice(0, 5)).toEqual(['t:0', 't:1', 't:0', 't:1', 't:2']);
  });
  it('looping a zero-duration script does not spin', () => {
    const clock = new FakeClock();
    const r = createReplaySource(
      script({ loop: true, events: [{ at: 0, event: ev('dean') }], checkpoints: {} }),
      { clock },
    );
    let n = 0;
    r.subscribe(() => n++);
    r.play();
    clock.advance(160);
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThanOrEqual(11);
  });
  it('validates speed and seek targets', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    expect(() => r.setSpeed(3 as never)).toThrow(RangeError);
    expect(() => r.seek(Number.NaN)).toThrow(/finite/);
    expect(() => r.seek(Infinity)).toThrow(/finite/);
    r.seek(99999);
    expect(r.position).toBe(3000);
    r.seek(-5);
    expect(r.position).toBe(0);
  });
});

describe('ReplaySource', () => {
  it.each([
    [1, [0, 1000, 1000, 3000]],
    [2, [0, 500, 500, 1500]],
    [0.5, [0, 2000, 2000, 6000]],
  ] as const)('timing at %sx', (speed, wall) => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock, speed });
    const seen: number[] = [];
    r.subscribe(() => seen.push(clock.now()));
    r.play();
    clock.advance(10000);
    expect(seen).toEqual(wall);
    expect(r.status).toBe('ended');
  });
  it('same-timestamp events keep order', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    const got: string[] = [];
    r.subscribe((e) => e.t === 'agent.state' && got.push(e.agent));
    r.play();
    clock.advance(1000);
    expect(got).toEqual(['dean', 'dean', 'student:s_ana']);
  });
  it('pause and resume neither skip nor duplicate', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    let n = 0;
    r.subscribe(() => n++);
    r.play();
    clock.advance(600);
    r.pause();
    clock.advance(5000);
    expect(n).toBe(1);
    r.play();
    clock.advance(399);
    expect(n).toBe(1);
    clock.advance(1);
    expect(n).toBe(3);
    clock.advance(5000);
    expect(n).toBe(4);
  });
  it('seek to a checkpoint then continue; fast mode replays earlier state', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    const metas: (boolean | undefined)[] = [];
    r.subscribe((_e, m) => metas.push(m?.fast));
    r.seek('mid', { replayState: true });
    expect(metas).toEqual([true]);
    r.play();
    clock.advance(0);
    expect(metas.length).toBe(3);
    clock.advance(2000);
    expect(metas.length).toBe(4);
    expect(() => r.seek('nope')).toThrow(/unknown checkpoint/);
  });
  it('loops', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script({ loop: true }), { clock });
    let n = 0;
    let loops = 0;
    r.subscribe(() => n++);
    r.onLoop(() => loops++);
    r.play();
    clock.advance(3000);
    expect(loops).toBe(1);
    clock.advance(3000);
    expect(n).toBe(9);
    expect(r.status).toBe('playing');
  });
  it('speed change mid-play keeps position', () => {
    const clock = new FakeClock();
    const r = createReplaySource(script(), { clock });
    r.play();
    clock.advance(500);
    r.setSpeed(2);
    expect(r.position).toBe(500);
    clock.advance(250);
    expect(r.position).toBe(1000);
  });
  it('rejects invalid scripts with readable errors', () => {
    expect(() => createReplaySource({ nope: 1 })).toThrow(/invalid replay script/);
    expect(() => createReplaySource('{bad')).toThrow(/invalid JSON/);
    const bad = script({
      events: [
        {
          at: 0,
          event: { t: 'ledger.entry', taskId: 'x', student: 's', field: 'f', value: '$180' },
        },
      ],
    });
    expect(() => createReplaySource(bad)).toThrow();
  });
  it('plays a script with every event type', () => {
    const samples: Record<string, unknown> = {
      'agent.state': ev('dean'),
      'agent.message': {
        t: 'agent.message',
        from: 'dean',
        to: 'commons',
        taskId: 'x',
        kind: 'k',
        shared: [],
      },
      'ledger.entry': {
        t: 'ledger.entry',
        taskId: 'x',
        student: 's',
        field: 'f',
        withheld: 'hidden',
      },
      'confirm.pending': { t: 'confirm.pending', student: 's', taskId: 'x', question: 'q' },
      'confirm.done': { t: 'confirm.done', student: 's', taskId: 'x', question: 'q' },
      'council.opinion': { t: 'council.opinion', councilId: 'c', member: 'm' },
      'council.rank': { t: 'council.rank', councilId: 'c', member: 'm' },
      'council.verdict': { t: 'council.verdict', councilId: 'c', member: 'm' },
      'quiz.question': { t: 'quiz.question', quizId: 'q', chapter: 'c' },
      'quiz.answer': { t: 'quiz.answer', quizId: 'q', chapter: 'c' },
      'quiz.result': { t: 'quiz.result', quizId: 'q', chapter: 'c' },
      'call.start': { t: 'call.start', agent: 'dean', callId: 'c' },
      'call.caption': { t: 'call.caption', agent: 'dean', callId: 'c' },
      'call.end': { t: 'call.end', agent: 'dean', callId: 'c' },
      'trip.confirmed': { t: 'trip.confirmed', taskId: 'x', squadId: 's' },
      'mastery.changed': { t: 'mastery.changed', student: 's', chapter: 'c', box: 1 },
    };
    const clock = new FakeClock();
    const r = createReplaySource(
      script({
        events: VILLAGE_EVENT_TYPES.map((t, i) => ({ at: i * 10, event: samples[t] })),
        checkpoints: {},
      }),
      { clock },
    );
    const got: string[] = [];
    r.subscribe((e) => got.push(e.t));
    r.play();
    clock.advance(1000);
    expect(got).toEqual([...VILLAGE_EVENT_TYPES]);
  });
});

class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  onopen: EventSourceLike['onopen'] = null;
  onmessage: EventSourceLike['onmessage'] = null;
  onerror: EventSourceLike['onerror'] = null;
  closed = false;
  listeners = new Map<string, ((ev: { data: string; lastEventId?: string }) => void)[]>();
  addEventListener(type: string, fn: (ev: { data: string; lastEventId?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  named(type: string, seq: number, data: unknown) {
    for (const fn of this.listeners.get(type) ?? [])
      fn({ data: JSON.stringify(data), lastEventId: String(seq) });
  }
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  close() {
    this.closed = true;
  }
  msg(seq: number, data: unknown) {
    this.onmessage?.({
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: String(seq),
    });
  }
}

type Snap = object | (() => object | Promise<object>);
const fetchLog: string[] = [];
function hubFetch(snapshot: Snap): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    fetchLog.push(u);
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
    if (u.includes('/stream-token')) return ok({ st: 'tok' });
    if (u.includes('/v1/squad/state')) {
      const snap = typeof snapshot === 'function' ? await snapshot() : snapshot;
      return ok(snap);
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('LiveSource', () => {
  const mk = (extra: object = {}, snap: Snap = { seq: 5, agents: { dean: 'studying' } }) => {
    FakeES.all = [];
    fetchLog.length = 0;
    const clock = new FakeClock();
    const warn = vi.fn();
    const live = createLiveSource({
      baseUrl: 'http://hub',
      fetch: hubFetch(snap),
      EventSource: FakeES,
      clock,
      logger: { warn },
      me: 's_ana',
      ...extra,
    });
    return { live, clock, warn };
  };
  it('snapshot first, then stream; resumes with lastEventId; dedupes overlap', async () => {
    const { live, clock } = mk();
    const got: [string, boolean | undefined][] = [];
    live.subscribe((e, m) => got.push([e.t === 'agent.state' ? e.agent : e.t, m?.snapshot]));
    await live.start();
    expect(got).toEqual([['dean', true]]);
    const es = FakeES.all[0]!;
    expect(es.url).toContain('st=tok');
    expect(es.url).toContain('lastEventId=5');
    es.onopen?.({});
    expect(live.status).toBe('live');
    es.msg(5, ev('dedupe-me')); // already covered by snapshot
    es.msg(6, ev('student:s_ben'));
    es.msg(6, ev('student:s_ben'));
    expect(got.map((g) => g[0])).toEqual(['dean', 'student:s_ben']);
    es.onerror?.({});
    clock.advance(1000);
    await flush();
    const es2 = FakeES.all[1]!;
    expect(es2.url).toContain('lastEventId=6');
  });
  it('ignores malformed frames and over-sharing events', async () => {
    const { live, warn } = mk();
    const got: VillageEvent[] = [];
    live.subscribe((e) => got.push(e));
    await live.start();
    const es = FakeES.all[0]!;
    es.msg(10, '{nope');
    es.msg(11, {
      t: 'ledger.entry',
      taskId: 'x',
      student: 's',
      field: 'budget',
      withheld: 'hidden',
      value: '$180',
    });
    es.msg(12, { t: 'unknown' });
    expect(got.filter((e) => e.t !== 'agent.state')).toEqual([]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('$180');
  });
  it('falls back to polling /v1/squad/state, emits only changed events, keeps retrying SSE, recovers', async () => {
    let snap: object = { seq: 0, agents: { dean: 'idle' } };
    const { live, clock } = mk({}, () => snap);
    const got: [string, string][] = [];
    live.subscribe((e, m) => {
      if (e.t === 'agent.state') got.push([e.agent + ':' + e.state, m?.snapshot ? 's' : '-']);
    });
    await live.start();
    expect(got).toEqual([['dean:idle', 's']]);
    FakeES.all[0]!.onerror?.({});
    expect(live.status).toBe('reconnecting');
    clock.advance(1000);
    await flush();
    FakeES.all[1]!.onerror?.({});
    expect(live.status).toBe('polling');
    await flush();
    clock.advance(0);
    await flush();
    expect(got).toHaveLength(1); // unchanged since the snapshot: nothing re-emitted
    snap = { seq: 1, agents: { dean: 'studying' } };
    clock.advance(2000);
    await flush();
    expect(got.at(-1)).toEqual(['dean:studying', 's']);
    clock.advance(2000);
    await flush();
    expect(got).toHaveLength(2); // dedupe by JSON
    expect(fetchLog.some((u) => u.includes('/v1/squad/events'))).toBe(false);
    clock.advance(10000);
    await flush();
    expect(FakeES.all.length).toBeGreaterThan(2); // SSE retried while polling
    FakeES.all.at(-1)!.onopen?.({});
    expect(live.status).toBe('live');
    const n = fetchLog.length;
    clock.advance(10000);
    await flush();
    expect(fetchLog.filter((u) => u.includes('/state')).length).toBe(
      fetchLog.slice(0, n).filter((u) => u.includes('/state')).length,
    );
  });
  it('never runs two polling chains when onerror fires repeatedly', async () => {
    const { live, clock } = mk({ errorsBeforePolling: 1 });
    await live.start();
    FakeES.all[0]!.onerror?.({});
    const before = fetchLog.filter((u) => u.includes('/state')).length;
    clock.advance(1000);
    await flush();
    FakeES.all[1]!.onerror?.({});
    FakeES.all[1]!.onerror?.({});
    clock.advance(1);
    await flush();
    clock.advance(2000);
    await flush();
    const polls = fetchLog.filter((u) => u.includes('/state')).length - before;
    expect(polls).toBeLessThanOrEqual(3);
    expect(polls).toBeGreaterThan(0);
    live.close();
    const after = fetchLog.length;
    clock.advance(60000);
    await flush();
    expect(fetchLog.length).toBe(after);
  });
  it('close during the stream-token await creates no EventSource', async () => {
    const { live } = mk();
    const p = live.start();
    await Promise.resolve();
    live.close();
    await p;
    await flush();
    expect(FakeES.all).toHaveLength(0);
  });
  it('close during the snapshot await delivers nothing and opens nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { live } = mk({}, async () => {
      await gate;
      return { seq: 1, agents: { dean: 'studying' } };
    });
    const got: string[] = [];
    live.subscribe((e) => got.push(e.t));
    const p = live.start();
    await flush();
    live.close();
    release();
    await p;
    await flush();
    expect(got).toEqual([]);
    expect(FakeES.all).toHaveLength(0);
  });
  it('lastId follows the snapshot down after a hub restart (resync)', async () => {
    let snap: object = { seq: 50, agents: {} };
    const { live, clock } = mk({}, () => snap);
    await live.start();
    const es = FakeES.all[0]!;
    es.onopen?.({});
    es.msg(51, ev('student:s_ben'));
    snap = { seq: 3, agents: { dean: 'studying' } };
    es.named('x.resync', 0, { seq: 3 });
    await flush();
    const got: string[] = [];
    live.subscribe((e) => e.t === 'agent.state' && got.push(e.agent));
    es.msg(4, ev('student:s_cy'));
    expect(got).toEqual(['student:s_cy']);
    es.msg(4, ev('student:s_cy'));
    expect(got).toHaveLength(1);
    es.onerror?.({});
    clock.advance(1000);
    await flush();
    expect(FakeES.all[1]!.url).toContain('lastEventId=4');
  });
  it('buffers stream frames during a resync snapshot, flushes after, marks resync', async () => {
    let release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    const { live } = mk({}, async () => {
      await gate;
      return { seq: 7, agents: { dean: 'studying' } };
    });
    const got: [string, string][] = [];
    live.subscribe((e, m) => {
      if (e.t === 'agent.state')
        got.push([e.agent, m?.resync ? 'resync' : m?.snapshot ? 'snap' : 'live']);
    });
    await live.start();
    const es = FakeES.all[0]!;
    es.onopen?.({});
    gate = new Promise<void>((r) => (release = r));
    es.named('x.resync', 0, { seq: 7 });
    await flush();
    es.msg(8, ev('student:s_a'));
    es.msg(9, ev('student:s_b'));
    expect(got).toEqual([['dean', 'snap']]);
    release();
    await flush();
    expect(got).toEqual([
      ['dean', 'snap'],
      ['dean', 'resync'],
      ['student:s_a', 'live'],
      ['student:s_b', 'live'],
    ]);
  });
  it('registers a listener for every VILLAGE_EVENT_TYPES entry and x.resync', async () => {
    const { live } = mk();
    await live.start();
    const es = FakeES.all[0]!;
    for (const t of VILLAGE_EVENT_TYPES) expect(es.listeners.has(t)).toBe(true);
    expect(es.listeners.has('x.resync')).toBe(true);
  });
  it('retries a failed snapshot with backoff (max 3) and reports onError without values', async () => {
    let calls = 0;
    const { live, clock } = mk({}, () => {
      if (++calls < 3) throw new Error('boom $180');
      return { seq: 2, agents: { dean: 'studying' } };
    });
    const kinds: string[] = [];
    live.onError((k) => kinds.push(k));
    const got: [string, boolean | undefined][] = [];
    live.subscribe((e, m) => e.t === 'agent.state' && got.push([e.agent, m?.snapshot]));
    await live.start();
    expect(kinds).toEqual(['snapshot']);
    expect(got).toEqual([]);
    clock.advance(1000);
    await flush();
    expect(kinds).toEqual(['snapshot', 'snapshot']);
    clock.advance(2000);
    await flush();
    expect(got).toEqual([['dean', true]]);
    clock.advance(60000);
    await flush();
    expect(calls).toBe(3);
  });
  it('gives up after 3 snapshot retries and reports stream errors', async () => {
    let calls = 0;
    const { live, clock } = mk({}, () => {
      calls++;
      throw new Error('down');
    });
    const kinds: string[] = [];
    live.onError((k) => kinds.push(k));
    await live.start();
    for (let i = 0; i < 10; i++) {
      clock.advance(20000);
      await flush();
    }
    expect(calls).toBe(4);
    FakeES.all[0]!.onerror?.({});
    expect(kinds.at(-1)).toBe('stream');
  });
  it('a throwing subscriber does not stop delivery and is logged generically', async () => {
    const { live, warn } = mk();
    const got: string[] = [];
    live.subscribe(() => {
      throw new Error('secret $180');
    });
    live.subscribe((e) => got.push(e.t));
    await live.start();
    FakeES.all[0]!.msg(9, ev('student:s_a'));
    expect(got).toEqual(['agent.state', 'agent.state']);
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('$180');
  });
  it('close releases everything', async () => {
    const { live } = mk();
    const un = live.subscribe(() => {});
    await live.start();
    live.close();
    expect(FakeES.all[0]!.closed).toBe(true);
    expect(live.status).toBe('closed');
    un();
  });
  it('snapshot becomes events for agents, confirms, calls and quizzes', async () => {
    const { live } = mk(
      {},
      {
        seq: 2,
        agents: { 'student:s_ana': 'waiting_for_student' },
        pendingConfirms: [{ taskId: 't', question: 'Share?' }],
        calls: [{ callId: 'c', agent: 'expert:ch5', mine: true }],
        quizzes: [{ quizId: 'q', chapter: 'ch5', target: 's_ana' }],
      },
    );
    const got: string[] = [];
    live.subscribe((e) => got.push(e.t));
    await live.start();
    expect(got).toEqual(['agent.state', 'confirm.pending', 'call.start', 'quiz.question']);
  });
});

import { tripCutsceneFromQuery, withTripCutscene } from './index';

describe('withTripCutscene', () => {
  it('delivers one synthetic trip.confirmed first, then the wrapped source', () => {
    const inner = {
      subscribe: (fn: (e: VillageEvent) => void) => {
        fn(ev('dean'));
        return () => {};
      },
    };
    const got: string[] = [];
    withTripCutscene(inner, { taskId: 't1', squadId: 's1' }).subscribe((e) => got.push(e.t));
    expect(got).toEqual(['trip.confirmed', 'agent.state']);
  });
  it('with verify, emits only after it resolves true, once per subscriber, never twice', async () => {
    let resolve!: (v: boolean) => void;
    const verify = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const inner = { subscribe: () => () => {} };
    const w = withTripCutscene(inner, { taskId: 't1', squadId: 's1', verify });
    const a: string[] = [];
    const b: string[] = [];
    w.subscribe((e) => a.push(e.t));
    expect(a).toEqual([]);
    resolve(true);
    await flush();
    expect(a).toEqual(['trip.confirmed']);
    w.subscribe((e) => b.push(e.t));
    await flush();
    expect(b).toEqual(['trip.confirmed']);
    expect(a).toEqual(['trip.confirmed']);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it('with verify false or rejected, emits nothing', async () => {
    const inner = { subscribe: () => () => {} };
    for (const verify of [async () => false, async () => Promise.reject(new Error('x'))]) {
      const got: string[] = [];
      withTripCutscene(inner, { taskId: 't', squadId: 's', verify }).subscribe((e) =>
        got.push(e.t),
      );
      await flush();
      expect(got).toEqual([]);
    }
  });
  it('unsubscribing before verify resolves receives nothing', async () => {
    let resolve!: (v: boolean) => void;
    const inner = { subscribe: () => () => {} };
    const got: string[] = [];
    const un = withTripCutscene(inner, {
      taskId: 't',
      squadId: 's',
      verify: () => new Promise<boolean>((r) => (resolve = r)),
    }).subscribe((e) => got.push(e.t));
    un();
    resolve(true);
    await flush();
    expect(got).toEqual([]);
  });
  it('parses the query only when cutscene=trip and a task id are present', () => {
    expect(tripCutsceneFromQuery('?cutscene=trip&task=t9&squad=sq')).toEqual({
      taskId: 't9',
      squadId: 'sq',
    });
    expect(tripCutsceneFromQuery('?cutscene=trip')).toBeUndefined();
    expect(tripCutsceneFromQuery('?cutscene=other&task=t')).toBeUndefined();
    expect(tripCutsceneFromQuery('?cutscene=trip&task=t')).toEqual({
      taskId: 't',
      squadId: 'squad',
    });
  });
});
