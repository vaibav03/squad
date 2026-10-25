import type { MessageKind, Payload } from './schemas';

/** Ledger field a message kind touches. */
export function fieldFor(kind: MessageKind, payload: unknown): string {
  switch (kind) {
    case 'psi.blind':
    case 'psi.tokens':
    case 'psi.common':
      return 'calendar';
    case 'share.vec':
    case 'share.sum': {
      const purpose = (payload as { purpose?: string }).purpose;
      return (
        { cantAfford: 'budget', veto: 'hardNo', borda: 'vote', weakTopic: 'topics', cost: 'softCost', simulate: 'budget' } as Record<string, string>
      )[purpose ?? ''] ?? 'shares';
    }
    case 'query':
    case 'query.denied':
      return (payload as { about?: string }).about ?? 'query';
    case 'confirm.result':
      return 'confirm';
    default:
      return 'plan';
  }
}

/** VillageEvent `shared` labels: counts and outcomes only. Never values, never identities. */
export function labelsFor(kind: MessageKind, payload: unknown): string[] {
  switch (kind) {
    case 'task.open': {
      const p = payload as Payload<'task.open'>;
      return [`${p.flow} plan opened`, `${p.members.length} members`];
    }
    case 'psi.blind':
      {
      const n = (payload as Payload<'psi.blind'>).points.length;
      return [n === 0 ? 'request: blinded set' : `${n} blinded tokens (padded)`];
    }
    case 'psi.tokens':
      return [`${(payload as Payload<'psi.tokens'>).tokens.length} blinded tokens`];
    case 'psi.common':
      return [`${(payload as Payload<'psi.common'>).common.length} common slots`];
    case 'share.vec':
    case 'share.sum': {
      const p = payload as Payload<'share.vec'> | Payload<'share.sum'>;
      const n = 'share' in p ? p.share.length : p.sum.length;
      if (n === 0) return ['share' in p ? 'request: share' : 'request: sum'];
      return [`secret share of ${n} values (${p.purpose})`];
    }
    case 'confirm.result':
      return ['confirm answered'];
    case 'result':
      {
      const p = payload as Payload<'result'>;
      if (p.stage === 'none' || (p.stage === 'final' && !p.chosen)) return ['no plan'];
      return [p.stage === 'candidates' ? 'top options ranked' : p.stage === 'proposal' ? 'plan proposed' : 'plan found'];
    }
    case 'query':
      return [`asks: ${(payload as Payload<'query'>).about}`];
    case 'query.denied':
      return [`request denied: ${(payload as Payload<'query.denied'>).about}`];
    case 'conflict':
      return [(payload as Payload<'conflict'>).reason === 'no_common_slot' ? 'no slot works for everyone' : 'no option works for everyone'];
    case 'option_dropped':
      return [(payload as Payload<'option_dropped'>).reason === 'budget' ? 'option dropped: budget' : 'dropped: veto'];
  }
}
