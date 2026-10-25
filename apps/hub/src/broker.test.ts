import { describe, expect, it } from 'vitest';
import { createBroker } from './broker';
import { createCallRegistry } from './calls';
import { silentLogger } from './log';
import { createDirectory } from './store/directory';
import { createEventLog } from './store/eventlog';
import { createTripStore } from './store/trips';
import type { HubDeps, Viewer } from './types';

function make(maxQueue = 4, bufferSize = 100) {
  const directory = createDirectory();
  for (const id of ['s_ana', 's_ben', 's_chi'])
    directory.upsertStudent({ id, name: id, handle: id });
  directory.upsertSquad({ id: 'sq', name: 'sq', members: ['s_ana', 's_ben', 's_chi'] });
  const calls = createCallRegistry();
  const trips = createTripStore();
  const deps = {
    config: { sse: { bufferSize, maxQueue, pingMs: 1000 } },
    log: silentLogger,
    directory,
    events: createEventLog({ max: bufferSize }),
    calls,
    trips,
    filterCtx: { directory, calls, trips },
  } as unknown as HubDeps;
  deps.broker = createBroker(deps);
  const pub = (i: number, taskId?: string) =>
    deps.broker.publish(
      deps.events.append({
        kind: 'village',
        type: taskId ? 'agent.message' : 'agent.state',
        payload: taskId
          ? { t: 'agent.message', from: 'dean', to: 'commons', taskId, kind: 'k', shared: [] }
          : { t: 'agent.state', agent: 'dean', state: i % 2 ? 'idle' : 'studying' },
        squadId: null,
      }),
    );
  return { deps, pub };
}
const ana: Viewer = { studentId: 's_ana', squadId: 'sq', projector: false };

async function take(sub: { events: AsyncIterable<unknown> }, n: number) {
  const out: unknown[] = [];
  for await (const x of sub.events) {
    out.push(x);
    if (out.length >= n) break;
  }
  return out;
}

describe('broker', () => {
  it('resumes from an id with no gap and no duplicate while publishing', async () => {
    const { deps, pub } = make(100);
    for (let i = 0; i < 5; i++) pub(i);
    const sub = deps.broker.subscribe(ana, { afterSeq: 2 });
    pub(5);
    pub(6);
    const got = (await take(sub, 5)) as { id: number }[];
    expect(got.map((g) => g.id)).toEqual([3, 4, 5, 6, 7]);
    sub.close();
    expect(deps.broker.count()).toBe(0);
  });

  it('too old resumes get a resync item', async () => {
    const { deps, pub } = make(100, 3);
    for (let i = 0; i < 10; i++) pub(i);
    const sub = deps.broker.subscribe(ana, { afterSeq: 1 });
    const [first] = await take(sub, 1);
    expect(first).toEqual({ resync: 10 });
    sub.close();
  });

  it('a stalled consumer is dropped, memory stays flat, and count returns to zero', async () => {
    const { deps, pub } = make(8);
    const sub = deps.broker.subscribe(ana, {});
    expect(deps.broker.count()).toBe(1);
    const heap0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20_000; i++) pub(i);
    expect(deps.broker.count()).toBe(0);
    expect(process.memoryUsage().heapUsed - heap0).toBeLessThan(20 * 1024 * 1024);
    // the iterator ends after the buffered items were discarded on close
    const rest = await take(sub, 1);
    expect(rest).toHaveLength(0);
  });

  it('taskId filter drops other tasks but passes events without one', async () => {
    const { deps, pub } = make(100);
    const sub = deps.broker.subscribe(ana, { taskId: 'a' });
    pub(1, 'b');
    pub(2, 'a');
    pub(3);
    const got = (await take(sub, 2)) as { id: number }[];
    expect(got.map((g) => g.id)).toEqual([2, 3]);
    sub.close();
  });

  it('closeAll ends every iterable', async () => {
    const { deps } = make();
    const a = deps.broker.subscribe(ana, {});
    const p = take(a, 1);
    deps.broker.closeAll();
    expect(await p).toHaveLength(0);
    expect(deps.broker.count()).toBe(0);
  });
});
