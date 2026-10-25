import { meetsMinGroupSize, type AgentMessage } from '@squad/core';
import { canonicalJson } from '../crypto';
import type { Ledger, LedgerRow } from '../ledger/ledger';
import { fieldFor, labelsFor, parseMessage, TaskTracker, type MessageKind } from '../protocol';
import { buildNeedles, findPrivateLeak, type PrivateFields } from './scan';

export type SendFailReason = 'schema' | 'leak' | 'budget' | 'unknown_kind' | 'min_group';
export type GateResult =
  | { ok: true; msg: AgentMessage; kind: MessageKind; labels: string[]; ledger: LedgerRow[] }
  | { ok: false; reason: SendFailReason; ledger: LedgerRow[] };

export type ReceiveFailReason =
  'schema' | 'replay' | 'closed_task' | 'not_member' | 'unknown_kind' | 'budget' | 'misrouted';
export type ReceiveResult =
  { ok: true; msg: AgentMessage; kind: MessageKind } | { ok: false; reason: ReceiveFailReason };

export interface Gate {
  readonly self: string;
  readonly tasks: TaskTracker;
  send(msg: AgentMessage): GateResult;
  receive(raw: unknown): ReceiveResult;
  allowPublic(taskId: string, tokens: readonly (string | number)[]): void;
  closeTask(taskId: string, state?: 'completed' | 'failed' | 'canceled'): void;
}

export interface GateOptions {
  self: string;
  fields: PrivateFields;
  ledger: Ledger;
  /** Max `query` + `psi.blind` sends per task (also caps inbound queries per sender). Default 8. */
  queryBudget?: number;
}

const WITHHELD_LABEL: Record<string, string> = {
  calendar: 'event titles, busy hours',
  budget: 'budget cap',
  hardNo: 'hard-no reasons',
  vote: 'ranking',
  topics: 'weak topics',
  softCost: 'busy scores',
};
const withheldFor = (field: string): string => WITHHELD_LABEL[field] ?? 'nothing private';
const BUDGETED: ReadonlySet<string> = new Set(['query', 'psi.blind']);

export function createGate(o: GateOptions): Gate {
  const { self, ledger } = o;
  const cap = o.queryBudget ?? 8;
  const needles = buildNeedles(o.fields);
  ledger.guard([
    ...(o.fields.budget !== undefined ? [o.fields.budget] : []),
    ...(o.fields.events ?? []).map((e) => e.title),
    ...(o.fields.hardNos ?? []).map((h) => h.reason),
    ...(o.fields.weakTopics ?? []),
    ...(o.fields.secrets ?? []),
  ]);
  const tasks = new TaskTracker();
  const publicByTask = new Map<string, Set<string>>();
  const sentBudget = new Map<string, number>();
  const recvBudget = new Map<string, number>();
  const seen = new Set<string>();

  const blocked = (taskId: string, field: string): LedgerRow =>
    ledger.record({
      taskId,
      student: self,
      field,
      shared: 'nothing',
      withheld: withheldFor(field),
      blocked: true,
    });

  const publicSet = (taskId: string): Set<string> => {
    let s = publicByTask.get(taskId);
    if (!s) publicByTask.set(taskId, (s = new Set()));
    return s;
  };

  function allowPublic(taskId: string, tokens: readonly (string | number)[]): void {
    const s = publicSet(taskId);
    for (const t of tokens) s.add(String(t).toLowerCase());
  }

  /** Public values carried by a valid task.open (option labels, prices, dates) are exempt from the scan. */
  function learnPublic(taskId: string, payload: unknown): void {
    const p = payload as {
      options?: { id: string; label: string; perPerson?: number }[];
      topics?: string[];
    };
    for (const op of p.options ?? [])
      allowPublic(taskId, [op.id, op.label, ...(op.perPerson !== undefined ? [op.perPerson] : [])]);
    allowPublic(taskId, p.topics ?? []);
  }

  function send(msg: AgentMessage): GateResult {
    const taskId = typeof msg?.taskId === 'string' ? msg.taskId : 'unknown';
    const fail = (reason: SendFailReason, field: string): GateResult => ({
      ok: false,
      reason,
      ledger: [blocked(taskId.length <= 64 ? taskId : 'unknown', field)],
    });
    const parsed = parseMessage(msg);
    if (!parsed.ok)
      return fail(parsed.error === 'unknown_kind' ? 'unknown_kind' : 'schema', 'message');
    const { kind } = parsed;
    const field = fieldFor(kind, parsed.msg.payload);
    if (parsed.msg.from !== self) return fail('schema', field);

    // Public values of a task.open we initiate must not trip the scan.
    if (kind === 'task.open') learnPublic(taskId, parsed.msg.payload);
    const leak = findPrivateLeak(parsed.msg, needles, publicByTask.get(taskId));
    if (leak) return fail('leak', field);

    if (BUDGETED.has(kind)) {
      const n = (sentBudget.get(taskId) ?? 0) + 1;
      if (n > cap) return fail('budget', field);
      sentBudget.set(taskId, n);
    }

    if (kind === 'task.open' && !tasks.state(taskId)) {
      const members = (parsed.msg.payload as { members: string[] }).members;
      tasks.open(taskId, members);
    }
    if (kind === 'result') {
      const counts = (parsed.msg.payload as { counts: unknown }).counts;
      const members = tasks.members(taskId);
      if (counts !== null && !(members && meetsMinGroupSize(members.length)))
        return fail('min_group', field);
    }

    const labels = labelsFor(kind, parsed.msg.payload);
    const row = ledger.record({
      taskId,
      student: self,
      field,
      shared: labels.join('; '),
      withheld: withheldFor(field),
    });
    return { ok: true, msg: parsed.msg, kind, labels, ledger: [row] };
  }

  function receive(raw: unknown): ReceiveResult {
    const parsed = parseMessage(raw);
    if (!parsed.ok)
      return { ok: false, reason: parsed.error === 'unknown_kind' ? 'unknown_kind' : 'schema' };
    const { msg, kind } = parsed;
    if (msg.to !== self) return { ok: false, reason: 'misrouted' };
    const key = canonicalJson(msg);
    if (seen.has(key)) return { ok: false, reason: 'replay' };

    if (kind === 'task.open') {
      if (tasks.state(msg.taskId)) return { ok: false, reason: 'replay' };
      const members = (msg.payload as { members: string[] }).members;
      if (self !== 'mediator' && !members.includes(self))
        return { ok: false, reason: 'not_member' };
      if (self !== 'mediator' && !members.includes(msg.from))
        return { ok: false, reason: 'not_member' };
      tasks.open(msg.taskId, members);
      learnPublic(msg.taskId, msg.payload);
    } else {
      const state = tasks.state(msg.taskId);
      if (!state || !tasks.isOpen(msg.taskId)) return { ok: false, reason: 'closed_task' };
      const members = tasks.members(msg.taskId) ?? [];
      if (msg.from !== 'mediator' && !members.includes(msg.from))
        return { ok: false, reason: 'not_member' };
      if (kind === 'query') {
        const n = (recvBudget.get(`${msg.taskId}|${msg.from}`) ?? 0) + 1;
        recvBudget.set(`${msg.taskId}|${msg.from}`, n);
        if (n > cap) return { ok: false, reason: 'budget' };
      }
    }
    seen.add(key);
    return { ok: true, msg, kind };
  }

  return {
    self,
    tasks,
    send,
    receive,
    allowPublic,
    closeTask(taskId, state = 'completed') {
      if (!tasks.isOpen(taskId)) return;
      if (state === 'completed' && tasks.state(taskId) === 'submitted')
        tasks.transition(taskId, 'working');
      tasks.transition(taskId, state);
    },
  };
}

/**
 * The gate has no allowlist entry for raw private values to a peer, so every query is refused:
 * a blocked ledger row plus a `query.denied` reply. The reply carries only the topic asked about.
 */
export function answerQuery(gate: Gate, ledger: Ledger, msg: AgentMessage): AgentMessage | null {
  const parsed = parseMessage(msg);
  if (!parsed.ok || parsed.kind !== 'query') return null;
  const q = parsed.msg.payload as {
    about: 'budget' | 'calendar' | 'hardNo' | 'weakTopic';
    target: string;
  };
  if (q.target !== gate.self) return null;
  ledger.record({
    taskId: msg.taskId,
    student: gate.self,
    field: q.about,
    shared: 'nothing',
    withheld: withheldFor(q.about === 'weakTopic' ? 'topics' : q.about),
    blocked: true,
  });
  return {
    from: gate.self,
    to: msg.from,
    taskId: msg.taskId,
    kind: 'query.denied',
    payload: { about: q.about, reason: 'private' },
  };
}
