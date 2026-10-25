// Agent runtime: participant side (A2A handler) + the coordinator toolbox. See PROTOCOL.md.
import { agentId, type AgentMessage, type VillageEvent } from '@squad/core';
import { secureRng, seededRng, type Rng } from '../crypto';
import { createGate, answerQuery, type Gate, type GateResult } from '../gate';
import {
  createMemoryLedger,
  toAgentMessageEvent,
  toLedgerEvent,
  toQueryDeniedEvent,
  type Ledger,
} from '../ledger';
import {
  psiApply,
  psiIntersect,
  psiKeygen,
  psiPrepare,
  psiResolve,
  psiTokens,
  type HexPoint,
} from '../psi';
import type { MessageKind, Payload, SharePurpose } from '../protocol';
import {
  combineSums,
  decodeShares,
  encodeShares,
  splitVector,
  sumShareVectors,
} from '../secretshare';
import { optionsOf, ownLimits, psiInput, rawWithheld, vectorFor, type TaskView } from './hooks';
import type {
  AgentDeps,
  Coord,
  FlowAgent,
  FlowOutcome,
  StudentId,
  TripOptionPublic,
  TripRecordLike,
  WireReply,
} from './types';
import { runStudy } from './study';
import { runTrip } from './trip';

export class FlowError extends Error {
  constructor(public readonly reason: 'offline' | 'timeout' | 'blocked') {
    super(reason); // fixed vocabulary only: never carries a value
    this.name = 'FlowError';
  }
}

interface TaskCtx {
  view: TaskView;
  rng: Rng;
  psi?: { secret: bigint; index: (string | null)[]; final?: HexPoint[] };
  inbox: Map<string, Map<string, bigint[]>>;
  closed: boolean;
}
interface ConfirmWait {
  need: Set<string>;
  yes: Set<string>;
  optionId: string;
  done: (ok: boolean) => void;
}

const DEFAULT_PEER_MS = 5_000;
const DEFAULT_CONFIRM_MS = 600_000;
const key = (p: string, r: number): string => `${p}:${r}`;
const yes = (a: string): boolean => /^\s*(y|yes|ok|sure|1)\b/i.test(a);

export function createAgent(deps: AgentDeps): FlowAgent {
  const { profile, net, emitter } = deps;
  const id: StudentId = profile.id;
  const peerMs = deps.timeouts?.peerMs ?? DEFAULT_PEER_MS;
  const confirmMs = deps.timeouts?.confirmMs ?? DEFAULT_CONFIRM_MS;
  const log = deps.log ?? (() => undefined);
  const ledger: Ledger = deps.ledger ?? createMemoryLedger();
  const gate: Gate = createGate({
    self: id,
    ledger,
    queryBudget: deps.queryBudget ?? 8,
    fields: {
      budget: profile.budget,
      events: profile.calendar.map((e) => ({ title: e.title })),
      hardNos: profile.hardNos.map((h) => ({ reason: h.reason })),
      // weak topics are NOT scanned: topic names are public task data (task.open.topics); what is private is
      // *that* this student is weak, which only ever travels as a secret share.
    },
  });
  // The mediator is hosted here but is a separate principal: its own gate, no private fields.
  const medGate: Gate = createGate({
    self: 'mediator',
    ledger: createMemoryLedger(),
    fields: {},
    queryBudget: 100_000,
  });
  const tasks = new Map<string, TaskCtx>();
  const confirms = new Map<string, ConfirmWait>();
  const coordinated = new Set<string>();
  const tripRecs = new Map<string, TripRecordLike>();
  const publishTrip = async (taskId: string): Promise<void> => {
    const rec = tripRecs.get(taskId);
    if (!rec) return;
    try {
      await deps.hub?.tripUpsert(structuredClone(rec));
    } catch {
      /* hub is best effort */
    }
  };

  const emit = async (e: VillageEvent): Promise<void> => {
    try {
      await emitter.emit(e);
    } catch {
      /* emitting must never break a flow */
    }
  };
  const privateRow = async (row: {
    taskId: string;
    student: string;
    field: string;
    shared: string;
    ts: number;
  }): Promise<void> => {
    try {
      await deps.hub?.ledgerPrivate({ ...row, withheld: rawWithheld(row.field, profile) });
    } catch {
      /* the owner view is best effort */
    }
  };
  const state = (s: 'studying' | 'idle') =>
    emit({ t: 'agent.state', agent: agentId.student(id), state: s });

  const rngFor = (taskId: string): Rng =>
    deps.seed === undefined ? secureRng() : seededRng(`${deps.seed}|${id}|${taskId}`);

  async function gatedSend(
    g: Gate,
    msg: AgentMessage,
    o: { quiet?: boolean } = {},
  ): Promise<AgentMessage> {
    const r: GateResult = g.send(msg);
    if (g === gate)
      for (const row of r.ledger) {
        await emit(toLedgerEvent(row));
        await privateRow(row);
      }
    if (!r.ok) {
      log(`gate blocked ${msg.kind}: ${r.reason}`);
      throw new FlowError('blocked');
    }
    if (!o.quiet) await emit(toAgentMessageEvent(r.msg, r.labels));
    return r.msg;
  }

  function coordinatorOf(taskId: string): string {
    return tasks.get(taskId)?.view.coordinator ?? id;
  }

  async function timed<T>(p: Promise<T>): Promise<T> {
    let t: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new FlowError('timeout')), peerMs);
    });
    try {
      return await Promise.race([p, timeout]);
    } catch (e) {
      throw e instanceof FlowError ? e : new FlowError('offline');
    } finally {
      clearTimeout(t);
    }
  }

  async function deliver(msg: AgentMessage): Promise<WireReply> {
    const target = msg.to === 'mediator' ? coordinatorOf(msg.taskId) : msg.to;
    if (target === id) return handle(msg);
    return timed(net.send(target, msg));
  }

  const ok = (taskId: string, st: WireReply['state'], message?: AgentMessage): WireReply => ({
    taskId,
    state: st,
    ...(message ? { message } : {}),
  });
  const fail = (taskId: string, error: string): WireReply => ({ taskId, state: 'failed', error });

  /* ---------------------------------------------------------------- participant side */

  function openTask(taskId: string, open: Payload<'task.open'>, coordinator: string): TaskCtx {
    const t: TaskCtx = {
      view: {
        taskId,
        open,
        members: [...open.members].sort(),
        self: id,
        coordinator,
        common: [],
        dropped: new Set(),
        candidates: [],
      },
      rng: rngFor(taskId),
      inbox: new Map(),
      closed: false,
    };
    tasks.set(taskId, t);
    return t;
  }

  async function closeTask(t: TaskCtx, st: 'completed' | 'failed'): Promise<void> {
    if (t.closed) return;
    t.closed = true;
    gate.closeTask(t.view.taskId, st);
    if (coordinated.has(t.view.taskId)) medGate.closeTask(t.view.taskId, st);
    await state('idle');
  }

  async function reply(
    to: string,
    taskId: string,
    kind: MessageKind,
    payload: unknown,
    st: WireReply['state'] = 'working',
  ): Promise<WireReply> {
    const msg = await gatedSend(
      gate,
      { from: id, to, taskId, kind, payload },
      { quiet: kind === 'query.denied' },
    );
    return ok(taskId, st, msg);
  }

  async function onProposal(t: TaskCtx, p: Payload<'result'>): Promise<void> {
    const { taskId, open } = t.view;
    const opt = (open.options ?? []).find((o) => o.id === p.chosen);
    const question =
      open.flow === 'trip'
        ? `${opt?.label ?? p.chosen}, ${p.dates?.[0] ?? ''} to ${p.dates?.at(-1) ?? ''}, $${p.perPerson ?? opt?.perPerson ?? 0} each. Yes?`
        : `Study session ${p.slot ?? p.chosen} UTC. Does it work for you?`;
    let accept = false;
    try {
      accept = yes(await deps.askConfirm(id, question, ['Yes', 'No'], taskId));
    } catch {
      accept = false;
    }
    try {
      const msg = await gatedSend(gate, {
        from: id,
        to: 'mediator',
        taskId,
        kind: 'confirm.result',
        payload: { accept, optionId: p.chosen ?? 'none' },
      });
      await deliver(msg);
    } catch {
      /* coordinator unreachable: it will time out and treat this as a no */
    }
  }

  async function dispatchMember(msg: AgentMessage, kind: MessageKind): Promise<WireReply> {
    const taskId = msg.taskId;
    if (kind === 'task.open') {
      const t = openTask(taskId, msg.payload as Payload<'task.open'>, msg.from);
      void t;
      await state('studying');
      return ok(taskId, 'working');
    }
    const t = tasks.get(taskId);
    if (!t) return fail(taskId, 'unknown_task');
    switch (kind) {
      case 'psi.blind': {
        const p = msg.payload as Payload<'psi.blind'>;
        if (p.round === 0) {
          const { items, padTo } = psiInput(t.view.open, profile);
          const secret = psiKeygen(t.rng);
          const prep = psiPrepare(secret, items, { padTo, rng: t.rng });
          t.psi = { secret, index: prep.index };
          return reply('mediator', taskId, 'psi.blind', {
            round: 0,
            points: prep.blinded,
            origin: id,
            hop: 0,
          });
        }
        if (p.round === 1) {
          if (!t.psi) return fail(taskId, 'no_psi');
          return reply('mediator', taskId, 'psi.blind', {
            round: 1,
            points: psiApply(t.psi.secret, p.points),
            origin: p.origin,
            hop: p.hop + 1,
          });
        }
        if (p.round === 2 && t.psi && p.origin === id) {
          t.psi.final = p.points;
          return reply('mediator', taskId, 'psi.tokens', { tokens: psiTokens(p.points) });
        }
        return fail(taskId, 'bad_round');
      }
      case 'psi.common': {
        if (!t.psi?.final) return fail(taskId, 'no_psi');
        t.view.common = psiResolve(
          t.psi.index,
          t.psi.final,
          (msg.payload as Payload<'psi.common'>).common,
        );
        return ok(taskId, 'working');
      }
      case 'share.vec': {
        const p = msg.payload as Payload<'share.vec'>;
        const k = key(p.purpose, p.round);
        const box = t.inbox.get(k) ?? new Map<string, bigint[]>();
        t.inbox.set(k, box);
        if (p.share.length > 0) {
          box.set(msg.from, decodeShares(p.share));
          return ok(taskId, 'working');
        }
        // contribute request from the mediator
        const vec = vectorFor(p.purpose as SharePurpose, p.round, t.view, profile);
        const parts = splitVector(vec, t.view.members.length, t.rng);
        box.set(id, parts[t.view.members.indexOf(id)]!);
        for (const [j, peer] of t.view.members.entries()) {
          if (peer === id) continue;
          const out = await gatedSend(gate, {
            from: id,
            to: peer,
            taskId,
            kind: 'share.vec',
            payload: { purpose: p.purpose, round: p.round, share: encodeShares(parts[j]!) },
          });
          const r = await deliver(out);
          if (r.state === 'failed') throw new FlowError('offline');
        }
        return ok(taskId, 'working');
      }
      case 'share.sum': {
        const p = msg.payload as Payload<'share.sum'>;
        const box = t.inbox.get(key(p.purpose, p.round));
        if (!box || box.size < t.view.members.length) return fail(taskId, 'incomplete_shares');
        const sum = sumShareVectors(t.view.members.map((m) => box.get(m)!));
        return reply('mediator', taskId, 'share.sum', {
          purpose: p.purpose,
          round: p.round,
          sum: encodeShares(sum),
        });
      }
      case 'option_dropped':
        t.view.dropped.add((msg.payload as Payload<'option_dropped'>).optionId);
        return ok(taskId, 'working');
      case 'conflict':
        return ok(taskId, 'working');
      case 'result': {
        const p = msg.payload as Payload<'result'>;
        if (p.stage === 'candidates') {
          t.view.candidates = p.candidates ?? [];
          return ok(taskId, 'working');
        }
        if (p.stage === 'proposal') {
          void onProposal(t, p);
          return ok(taskId, 'input-required');
        }
        await closeTask(t, p.stage === 'final' ? 'completed' : 'failed');
        return ok(taskId, p.stage === 'final' ? 'completed' : 'canceled');
      }
      case 'query': {
        const before = ledger.list(taskId).length;
        const denied = answerQuery(gate, ledger, msg);
        if (!denied) return fail(taskId, 'not_target');
        for (const row of ledger.list(taskId).slice(before)) {
          await emit(toLedgerEvent(row));
          await privateRow(row);
        }
        const about = (msg.payload as Payload<'query'>).about;
        await emit(toQueryDeniedEvent(taskId, msg.from, about));
        return ok(taskId, 'completed', denied);
      }
      default:
        return fail(taskId, 'unsupported');
    }
  }

  async function dispatchMediator(msg: AgentMessage, kind: MessageKind): Promise<WireReply> {
    if (kind === 'confirm.result') {
      const w = confirms.get(msg.taskId);
      const p = msg.payload as Payload<'confirm.result'>;
      const rec = tripRecs.get(msg.taskId);
      if (rec && p.optionId !== 'none') {
        const row = rec.confirmations.find((c) => c.student === msg.from);
        if (row) Object.assign(row, { confirmed: p.accept, optionId: p.optionId });
        rec.status = 'confirming';
        await publishTrip(msg.taskId);
      }
      if (w && p.optionId === w.optionId) {
        if (!p.accept) w.done(false);
        else {
          w.yes.add(msg.from);
          if (w.yes.size === w.need.size) w.done(true);
        }
      }
      return ok(msg.taskId, 'completed');
    }
    return fail(msg.taskId, 'unsupported');
  }

  async function handle(raw: unknown): Promise<WireReply> {
    const taskId =
      typeof (raw as { taskId?: unknown })?.taskId === 'string'
        ? (raw as { taskId: string }).taskId
        : 'unknown';
    try {
      const g = (raw as { to?: unknown })?.to === 'mediator' ? medGate : gate;
      const r = g.receive(raw);
      if (!r.ok) return fail(taskId, r.reason);
      return g === medGate
        ? await dispatchMediator(r.msg, r.kind)
        : await dispatchMember(r.msg, r.kind);
    } catch (e) {
      log(`handler error: ${e instanceof FlowError ? e.reason : 'internal'}`);
      return fail(taskId, e instanceof FlowError ? e.reason : 'internal');
    }
  }

  /* ---------------------------------------------------------------- coordinator side */

  async function mediatorCall(
    to: string,
    taskId: string,
    kind: MessageKind,
    payload: unknown,
    quiet = false,
  ): Promise<AgentMessage | undefined> {
    const msg = await gatedSend(
      medGate,
      { from: 'mediator', to, taskId, kind, payload },
      { quiet },
    );
    const r = await deliver(msg);
    if (r.state === 'failed') log(`${kind} to ${to} failed: ${r.error ?? 'unknown'}`);
    if (r.state === 'failed')
      throw new FlowError(
        r.error === 'timeout' ? 'timeout' : r.error === 'blocked' ? 'blocked' : 'offline',
      );
    if (r.message) {
      if (r.message.to === 'mediator') {
        const v = medGate.receive(r.message);
        if (!v.ok) throw new FlowError('blocked');
      }
      return r.message;
    }
    return undefined;
  }

  async function openAsCoordinator(
    flow: 'study' | 'trip',
    a: {
      taskId: string;
      members: StudentId[];
      window: { from: string; to: string };
      squadId?: string;
      options?: TripOptionPublic[];
      topics?: string[];
      examAt?: string;
    },
  ): Promise<Coord> {
    const members = [...new Set([...a.members, id])].sort();
    const open: Payload<'task.open'> = {
      flow,
      window: a.window,
      members,
      ...(a.squadId ? { squadId: a.squadId } : {}),
      ...(a.options
        ? {
            options: a.options.map((o) => ({
              id: o.id,
              label: o.label,
              perPerson: o.perPerson,
              dates: {
                from: a.window.from.slice(0, 10),
                to: new Date(
                  Date.parse(`${a.window.from.slice(0, 10)}T00:00:00Z`) + (o.days - 1) * 86_400_000,
                )
                  .toISOString()
                  .slice(0, 10),
              },
            })),
          }
        : {}),
      ...(a.topics ? { topics: a.topics } : {}),
      ...(a.examAt ? { examAt: a.examAt } : {}),
    };
    const t = openTask(a.taskId, open, id);
    coordinated.add(a.taskId);
    await state('studying');
    let first = true;
    for (const peer of members) {
      if (peer === id) continue;
      const msg = await gatedSend(
        gate,
        { from: id, to: peer, taskId: a.taskId, kind: 'task.open', payload: open },
        { quiet: !first },
      );
      first = false;
      const r = await deliver(msg);
      if (r.state === 'failed') throw new FlowError('offline');
    }
    const m = medGate.receive({
      from: id,
      to: 'mediator',
      taskId: a.taskId,
      kind: 'task.open',
      payload: open,
    });
    if (!m.ok) throw new FlowError('blocked');
    const { taskId } = a;
    if (flow === 'trip') {
      tripRecs.set(taskId, {
        tripId: taskId,
        taskId,
        squadId: a.squadId ?? taskId,
        status: 'planning',
        options: (a.options ?? []).map((o) => ({
          id: o.id,
          label: o.label,
          estCost: `$${o.perPerson}`,
        })),
        dates: null,
        votes: [],
        vetoed: [],
        confirmations: members.map((m) => ({ student: m, confirmed: false })),
        limits: { [id]: ownLimits(profile) },
      });
      await publishTrip(taskId);
    }

    const coord: Coord = {
      async trip(patch) {
        const rec = tripRecs.get(taskId);
        if (!rec) return;
        Object.assign(rec, patch);
        await publishTrip(taskId);
      },
      taskId,
      self: id,
      members,
      memberCount: members.length,
      open,
      view: () => t.view,
      venmoOf: () => profile.venmo,
      emit,
      async runPsi() {
        const sets: HexPoint[][] = [];
        const n = members.length;
        const initial = new Map<string, HexPoint[]>();
        for (const owner of members) {
          const r0 = await mediatorCall(owner, taskId, 'psi.blind', {
            round: 0,
            points: [],
            origin: owner,
            hop: 0,
          });
          initial.set(owner, (r0!.payload as Payload<'psi.blind'>).points);
        }
        for (const owner of members) {
          let points = initial.get(owner)!;
          const start = members.indexOf(owner);
          for (let k = 1; k < n; k++) {
            const peer = members[(start + k) % n]!;
            const r = await mediatorCall(peer, taskId, 'psi.blind', {
              round: 1,
              points,
              origin: owner,
              hop: k,
            });
            points = (r!.payload as Payload<'psi.blind'>).points;
          }
          const rt = await mediatorCall(owner, taskId, 'psi.blind', {
            round: 2,
            points,
            origin: owner,
            hop: n,
          });
          sets.push((rt!.payload as Payload<'psi.tokens'>).tokens);
        }
        const common = psiIntersect(sets);
        for (const m of members)
          await mediatorCall(m, taskId, 'psi.common', { common }, m !== members[0]);
        return { tokenCounts: sets.reduce((s, x) => s + x.length, 0), commonCount: common.length };
      },
      async sum(purpose, round) {
        for (const m of members)
          await mediatorCall(m, taskId, 'share.vec', { purpose, round, share: [] }, true);
        const sums: bigint[][] = [];
        for (const m of members) {
          const r = await mediatorCall(m, taskId, 'share.sum', { purpose, round, sum: [] }, true);
          sums.push(decodeShares((r!.payload as Payload<'share.sum'>).sum));
        }
        return combineSums(sums);
      },
      async tell(kind, payload) {
        for (const m of members) await mediatorCall(m, taskId, kind, payload, kind !== 'result');
      },
      async confirm(proposal, optionId) {
        const verdict = new Promise<boolean>((resolve) => {
          confirms.set(taskId, { need: new Set(members), yes: new Set(), optionId, done: resolve });
          setTimeout(() => resolve(false), confirmMs).unref?.();
        });
        try {
          for (const m of members) await mediatorCall(m, taskId, 'result', proposal);
        } catch (e) {
          confirms.get(taskId)?.done(false);
          confirms.delete(taskId);
          throw e;
        }
        const res = await verdict;
        confirms.delete(taskId);
        return res;
      },
    };
    return coord;
  }

  async function runFlow(
    flow: 'study' | 'trip',
    a: Parameters<typeof openAsCoordinator>[1],
  ): Promise<FlowOutcome> {
    let coord: Coord | undefined;
    try {
      coord = await openAsCoordinator(flow, a);
      return flow === 'study' ? await runStudy(coord) : await runTrip(coord);
    } catch (e) {
      const reason = e instanceof FlowError ? e.reason : 'blocked';
      log(`flow ${flow} failed: ${reason}`);
      // tell everyone to stand down (best effort), never emit trip.confirmed
      const none: Payload<'result'> = { stage: 'none', chosen: null, counts: null };
      for (const m of a.members.filter((x) => x !== id)) {
        try {
          await mediatorCall(m, a.taskId, 'result', none, true);
        } catch {
          /* peer offline */
        }
      }
      const t = tasks.get(a.taskId);
      if (t) await closeTask(t, 'failed');
      return flow === 'trip'
        ? { flow, status: 'no_plan', reason: reason === 'blocked' ? 'declined' : reason }
        : { flow, status: 'failed', reason };
    } finally {
      confirms.delete(a.taskId);
    }
  }

  async function askPeer(
    about: 'budget' | 'calendar' | 'hardNo' | 'weakTopic',
    target: StudentId,
    taskId: string,
  ): Promise<'denied'> {
    if (!gate.tasks.state(taskId)) {
      const members = [id, target].sort();
      const open: Payload<'task.open'> = {
        flow: 'trip',
        window: { from: '2026-01-01', to: '2026-01-02' },
        members,
        squadId: 'query',
      };
      openTask(taskId, open, id);
      const msg = await gatedSend(gate, {
        from: id,
        to: target,
        taskId,
        kind: 'task.open',
        payload: open,
      });
      await deliver(msg);
    }
    try {
      const msg = await gatedSend(gate, {
        from: id,
        to: target,
        taskId,
        kind: 'query',
        payload: { about, target },
      });
      const r = await deliver(msg);
      if (r.message) gate.receive(r.message);
    } catch (e) {
      if (!(e instanceof FlowError) || e.reason !== 'blocked') throw e;
      // the gate refused our own send (query budget): same public outcome
      await emit(toQueryDeniedEvent(taskId, id, about));
    }
    return 'denied';
  }

  return {
    id,
    handle,
    startStudy: (a) => runFlow('study', a),
    startTrip: (a) => runFlow('trip', a),
    askPeer,
  };
}
export { optionsOf };
