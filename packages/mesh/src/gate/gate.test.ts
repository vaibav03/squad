import fc from 'fast-check';
import { VillageEventSchema, type AgentMessage } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { describe, expect, it } from 'vitest';
import {
  createMemoryLedger,
  createSqliteLedger,
  LedgerLeakError,
  toAgentMessageEvent,
  toConflictEvent,
  toLedgerEvent,
  toOptionDroppedEvent,
  toQueryDeniedEvent,
} from '../ledger';
import { answerQuery, createGate } from './index';

const hex = 'ab'.repeat(32);
const limb = 'cd'.repeat(16);
const fields = {
  budget: 187,
  events: [{ title: 'therapy Tue 2pm' }],
  hardNos: [{ reason: 'under 21' }],
  weakTopics: ['dynamic programming'],
};
const mk = () => {
  const ledger = createMemoryLedger();
  return { ledger, gate: createGate({ self: 's_ana', fields, ledger }) };
};
const msg = (kind: string, payload: unknown, to = 'mediator', taskId = 't1'): AgentMessage => ({
  from: 's_ana',
  to,
  taskId,
  kind,
  payload,
});
const open = (members = ['s_ana', 's_ben', 's_chi']) =>
  msg(
    'task.open',
    { flow: 'trip', window: { from: '2026-11-27', to: '2026-11-29' }, members },
    's_ben',
  );

describe('gate.send', () => {
  it('drops an injected key and writes a blocked ledger row', () => {
    const { gate, ledger } = mk();
    const r = gate.send(
      msg('share.vec', { purpose: 'veto', round: 0, share: [limb], reason: 'under 21' }),
    );
    expect(r.ok).toBe(false);
    const rows = ledger.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blocked: true, shared: 'nothing' });
    expect(JSON.stringify(rows)).not.toMatch(/under 21/i);
  });
  it.each([
    ['title', { optionId: 'x', reason: 'budget' }, { id: 'therapy_tue_2pm' }],
    ['word', { id: 'Therapy' }],
    ['evaded', { id: 'th-er-apy' }],
    ['digits', { id: 'cap_187' }],
  ])('blocks leak (%s) in a label', (_n, ...rest) => {
    const { gate } = mk();
    const bad = rest[rest.length - 1] as { id: string };
    const r = gate.send(msg('query', { about: 'budget', target: bad.id }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('leak');
  });
  it('does not false-positive on hex payloads', () => {
    const { gate } = mk();
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-f]{32}$/), (h) => {
        const l = (h + '187187187187187187187187').slice(0, 32).toLowerCase();
        expect(
          gate.send(
            msg('share.vec', {
              purpose: 'veto',
              round: Math.floor(Math.random() * 1000),
              share: [l],
            }),
          ).ok,
        ).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
  it('allowPublic exempts a public option price equal to the budget', () => {
    const { gate } = mk();
    const o = msg(
      'task.open',
      {
        flow: 'trip',
        window: { from: '2026-11-27', to: '2026-11-29' },
        members: ['s_ana', 's_ben', 's_chi'],
        options: [{ id: 'flag', label: 'Flagstaff', perPerson: 187 }],
      },
      's_ben',
    );
    expect(gate.send(o).ok).toBe(false); // not derived from message content
    gate.allowPublic('t1', ['flag', 'Flagstaff', 187]);
    expect(gate.send(o).ok).toBe(true);
  });
  it('caps query/psi.blind sends per task (default 8)', () => {
    const { gate } = mk();
    const results = Array.from({ length: 10 }, (_, i) =>
      gate.send(msg('psi.blind', { round: 1, points: [hex], origin: 's_ana', hop: i % 3 })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(8);
    expect(results[8]).toMatchObject({ ok: false, reason: 'budget' });
  });
  it('result counts need a squad of 3+', () => {
    const { gate } = mk();
    const small = gate.send(open(['s_ana', 's_ben']));
    expect(small.ok).toBe(true);
    const r = gate.send(msg('result', { stage: 'final', chosen: 'flag', counts: { flag: 2 } }));
    expect(r).toMatchObject({ ok: false, reason: 'min_group' });
    expect(gate.send(msg('result', { stage: 'final', chosen: 'flag', counts: null })).ok).toBe(
      true,
    );
    const big = mk();
    big.gate.send(open());
    expect(
      big.gate.send(msg('result', { stage: 'final', chosen: 'flag', counts: { flag: 2 } })).ok,
    ).toBe(true);
  });
  it('rejects impersonation (from != self)', () => {
    const { gate } = mk();
    expect(
      gate.send({ ...msg('query', { about: 'budget', target: 's_ben' }), from: 's_ben' }).ok,
    ).toBe(false);
  });
});

describe('gate.receive', () => {
  const inbound = (kind: string, payload: unknown, from = 's_ben', taskId = 't1') => ({
    from,
    to: 's_ana',
    taskId,
    kind,
    payload,
  });
  const openIn = inbound('task.open', {
    flow: 'trip',
    window: { from: '2026-11-27', to: '2026-11-29' },
    members: ['s_ana', 's_ben', 's_chi'],
  });
  it('rejects replay, unknown task, closed task, non-members, misrouted', () => {
    const { gate } = mk();
    expect(gate.receive(inbound('psi.tokens', { tokens: [hex] }))).toMatchObject({
      ok: false,
      reason: 'closed_task',
    });
    expect(gate.receive(openIn).ok).toBe(true);
    expect(gate.receive(openIn)).toMatchObject({ ok: false, reason: 'replay' });
    const p = inbound('psi.tokens', { tokens: [hex] });
    expect(gate.receive(p).ok).toBe(true);
    expect(gate.receive(p)).toMatchObject({ ok: false, reason: 'replay' });
    expect(gate.receive(inbound('psi.tokens', { tokens: [hex] }, 's_evil'))).toMatchObject({
      ok: false,
      reason: 'not_member',
    });
    expect(gate.receive({ ...p, to: 's_chi' })).toMatchObject({ ok: false, reason: 'misrouted' });
    gate.closeTask('t1');
    expect(gate.receive(inbound('psi.common', { common: [hex] }))).toMatchObject({
      ok: false,
      reason: 'closed_task',
    });
  });
  it('caps inbound queries per sender', () => {
    const { gate } = mk();
    gate.receive(openIn);
    const rs = (['budget', 'calendar', 'hardNo', 'weakTopic'] as const).flatMap((a) =>
      [a, a].map((x, i) =>
        gate.receive(inbound('query', { about: x, target: i ? 's_ana' : 's_ana' }, 's_ben')),
      ),
    );
    expect(rs.filter((r) => r.ok).length).toBeLessThanOrEqual(4);
  });
  it('answerQuery denies with a blocked row and no value anywhere', () => {
    const { gate, ledger } = mk();
    const reply = answerQuery(gate, ledger, {
      from: 's_ben',
      to: 's_ana',
      taskId: 't1',
      kind: 'query',
      payload: { about: 'budget', target: 's_ana' },
    });
    expect(reply).toEqual({
      from: 's_ana',
      to: 's_ben',
      taskId: 't1',
      kind: 'query.denied',
      payload: { about: 'budget', reason: 'private' },
    });
    const rows = ledger.list();
    expect(rows[0]).toMatchObject({ blocked: true, field: 'budget', shared: 'nothing' });
    expect(JSON.stringify([reply, rows, toLedgerEvent(rows[0]!)])).not.toMatch(/187/);
    expect(
      answerQuery(gate, ledger, {
        from: 's_ben',
        to: 's_ana',
        taskId: 't1',
        kind: 'query',
        payload: { about: 'budget', target: 's_chi' },
      }),
    ).toBeNull();
  });
});

describe('INVARIANT: no gated output ever contains a withheld value', () => {
  const sentinelArb = fc.stringMatching(/^[a-z]{6,10}$/).map((s) => `zq${s}x`);
  it('any message carrying a sentinel is blocked; ledger and events stay clean', () => {
    fc.assert(
      fc.property(
        sentinelArb,
        fc.integer({ min: 1000, max: 99999 }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        (word, num, where, upper) => {
          const ledger = createMemoryLedger();
          const gate = createGate({
            self: 's_ana',
            fields: {
              budget: num,
              events: [{ title: `${word} meeting` }],
              hardNos: [{ reason: `${word}reason` }],
            },
            ledger,
          });
          const w = upper ? word.toUpperCase() : word;
          const leakers: AgentMessage[] = [
            msg('query', { about: 'budget', target: `${w}` }),
            msg('option_dropped', { optionId: `cap_${num}`, reason: 'budget' }),
            msg('query', { about: 'calendar', target: `${w.slice(0, 2)}-${w.slice(2)}` }),
            msg(
              'task.open',
              {
                flow: 'trip',
                window: { from: '2026-11-27', to: '2026-11-29' },
                members: ['s_ana', 's_ben', 's_chi'],
                options: [{ id: 'a', label: [w, `l${num}`][where % 2]! }],
              },
              's_ben',
            ),
          ];
          // the public allowlist is built from task.open itself; only the clean variants below may pass
          const r = leakers.map((m) => gate.send(m));
          expect(r[0]!.ok).toBe(false);
          expect(r[1]!.ok).toBe(false);
          expect(r[2]!.ok).toBe(false);
          expect(r[3]!.ok).toBe(false); // a message cannot whitelist its own leak
          const dump = JSON.stringify([
            ledger.list(),
            r.flatMap((x) => (x.ok ? x.labels : [])),
            ledger.list().map(toLedgerEvent),
          ]).toLowerCase();
          expect(dump).not.toContain(word);
          expect(dump).not.toContain(String(num));
        },
      ),
      { numRuns: 100 },
    );
  });
  it('ledger refuses guarded values without echoing them; sqlite round-trips; events validate', () => {
    const l = createMemoryLedger();
    l.guard(['secretvalue99']);
    let err: unknown;
    try {
      l.record({
        taskId: 't',
        student: 's',
        field: 'f',
        shared: 'x',
        withheld: 'has secretvalue99',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LedgerLeakError);
    expect(String((err as Error).message)).not.toContain('secretvalue99');
    const s = createSqliteLedger(openMemoryDb(), () => 5);
    s.record({
      taskId: 't',
      student: 's_ana',
      field: 'budget',
      shared: 'secret share of 1 values (cantAfford)',
      withheld: 'budget cap',
    });
    s.record({
      taskId: 't',
      student: 's_ana',
      field: 'budget',
      shared: 'nothing',
      withheld: 'budget cap',
      blocked: true,
    });
    const rows = s.list('t');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const ev = toLedgerEvent(row);
      expect(VillageEventSchema.safeParse(ev).success).toBe(true);
      expect(ev.withheld).toBe('hidden');
    }
    expect(rows[1]!.blocked).toBe(true);
    for (const e of [
      toAgentMessageEvent(msg('share.vec', { purpose: 'veto', round: 0, share: [limb] }, 's_ben'), [
        'x',
      ]),
      toQueryDeniedEvent('t', 's_ben', 'budget'),
      toOptionDroppedEvent('t', 'veto'),
      toConflictEvent('t', 'no_common_slot'),
    ]) {
      expect(VillageEventSchema.safeParse(e).success).toBe(true);
    }
    expect(toOptionDroppedEvent('t', 'veto').from).toBe('mediator');
  });
});
