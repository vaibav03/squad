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

function hubFetch(snapshot: object, polled: { seq: number; event: unknown }[] = []): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;
    if (u.includes('/stream-token')) return ok({ st: 'tok' });
    if (u.includes('/v1/squad/state')) return ok(snapshot);
    if (u.includes('/v1/squad/events')) return ok({ events: polled });
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('LiveSource', () => {
  const mk = (
    extra: object = {},
    snap: object = { seq: 5, agents: { dean: 'studying' } },
    polled = [],
  ) => {
    FakeES.all = [];
    const clock = new FakeClock();
    const warn = vi.fn();
    const live = createLiveSource({
      baseUrl: 'http://hub',
      fetch: hubFetch(snap, polled),
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
  it('falls back to polling after two errors, then recovers', async () => {
    const { live, clock } = mk({}, { seq: 0 }, [{ seq: 3, event: ev('dean') }] as never);
    const got: string[] = [];
    live.subscribe((e) => e.t === 'agent.state' && got.push(e.agent));
    await live.start();
    FakeES.all[0]!.onerror?.({});
    expect(live.status).toBe('reconnecting');
    clock.advance(1000);
    await flush();
    FakeES.all[1]!.onerror?.({});
    expect(live.status).toBe('polling');
    await vi.waitFor(() => {
      clock.advance(10);
      expect(got).toEqual(['dean']);
    });
    clock.advance(2000);
    const open = FakeES.all.at(-1)!;
    await vi.waitFor(() => expect(FakeES.all.length).toBeGreaterThan(2));
    FakeES.all.at(-1)!.onopen?.({});
    expect(open).toBeDefined();
    expect(live.status).toBe('live');
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
