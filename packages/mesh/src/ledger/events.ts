import { agentId, type AgentMessage, type VillageEvent } from '@squad/core';
import type { LedgerRow } from './ledger';

type LedgerEvt = Extract<VillageEvent, { t: 'ledger.entry' }>;
type MsgEvt = Extract<VillageEvent, { t: 'agent.message' }>;

const toAgent = (id: string): string =>
  id === 'mediator' || id === 'commons' ? id : agentId.student(id);

/** Public projection of a ledger row: labels only, withheld is the literal 'hidden'. */
export function toLedgerEvent(row: LedgerRow): LedgerEvt {
  return {
    t: 'ledger.entry',
    taskId: row.taskId,
    student: row.student,
    field: row.field,
    shared: row.shared,
    ...(row.withheld !== 'nothing private' ? { withheld: 'hidden' as const } : {}),
    ...(row.blocked ? { blocked: true as const } : {}),
  };
}

export function toAgentMessageEvent(msg: AgentMessage, labels: string[]): MsgEvt {
  const broadcast = msg.kind === 'psi.common' || msg.kind === 'task.open';
  return {
    t: 'agent.message',
    from: toAgent(msg.from),
    to: broadcast ? 'commons' : (toAgent(msg.to) as MsgEvt['to']),
    taskId: msg.taskId,
    kind: msg.kind,
    shared: labels,
  };
}

export function toQueryDeniedEvent(taskId: string, to: string, about = 'budget'): MsgEvt {
  return {
    t: 'agent.message',
    from: 'mediator',
    to: toAgent(to) as MsgEvt['to'],
    taskId,
    kind: 'query_denied',
    shared: [`request denied: ${about}`],
  };
}

export function toOptionDroppedEvent(taskId: string, reason: 'budget' | 'veto'): MsgEvt {
  return {
    t: 'agent.message',
    from: 'mediator',
    to: 'commons',
    taskId,
    kind: 'option_dropped',
    shared: [reason === 'budget' ? 'option dropped: budget' : 'dropped: veto'],
  };
}

export function toConflictEvent(
  taskId: string,
  reason: 'no_common_slot' | 'no_option' | 'no_plan',
): MsgEvt {
  return {
    t: 'agent.message',
    from: 'mediator',
    to: 'commons',
    taskId,
    kind: 'conflict',
    shared: [
      reason === 'no_common_slot'
        ? 'no slot works for everyone'
        : reason === 'no_option'
          ? 'no option works for everyone'
          : 'no plan found',
    ],
  };
}
