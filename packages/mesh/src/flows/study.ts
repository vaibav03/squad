// Study flow coordinator (mediator side). See PROTOCOL.md step 4.
import { meetsMinGroupSize } from '@squad/core';
import { toConflictEvent } from '../ledger';
import { chooseStudySlot, topicCoverage } from '../mediator';
import { hoursBetween } from './time';
import type { Coord, FlowOutcome } from './types';

const NONE = { stage: 'none' as const, chosen: null, counts: null };

export async function runStudy(c: Coord): Promise<FlowOutcome> {
  const { open, taskId } = c;
  await c.runPsi();
  const common = [...c.view().common].sort();

  const costTotals: Record<string, number> = {};
  if (common.length > 0) {
    (await c.sum('cost', 0)).forEach((t, i) => (costTotals[common[i]!] = t));
  }

  // Topic coverage: counts only, never for squads under 3, and a lone "weak" vote is not shown (it would name someone).
  let coverage: { topic: string; weak: number | null; lead: string | null }[] | undefined;
  if (open.topics?.length && meetsMinGroupSize(c.memberCount)) {
    const totals = await c.sum('weakTopic', 0);
    const weakTotals: Record<string, number> = {};
    open.topics.forEach((t, i) => (weakTotals[t] = totals[i]!));
    coverage = topicCoverage({ canTeach: {}, weakTotals, memberCount: c.memberCount }).filter(
      (r) => (r.weak ?? 0) >= 2,
    );
    for (const r of coverage) {
      await c.emit({
        t: 'agent.message',
        from: 'mediator',
        to: 'commons',
        taskId,
        kind: 'coverage',
        shared: [`${r.weak} of ${c.memberCount} shaky on ${r.topic}`],
      });
    }
  }

  const tried = new Set<string>();
  for (let round = 1; round <= 2; round++) {
    const remaining = common.filter((s) => !tried.has(s));
    const choice = chooseStudySlot({
      commonSlots: remaining,
      costTotals,
      ...(open.examAt ? { examAt: open.examAt } : {}),
      memberCount: c.memberCount,
    });
    if (choice.kind === 'conflict') {
      if (round === 2) break;
      // no (more) common slot: hybrid by fewest busy members, counts only
      const window = hoursBetween(open.window.from, open.window.to);
      const busy = await c.sum('cost', 1);
      const conflictCounts: Record<string, number> = {};
      window.forEach((h, i) => (conflictCounts[h] = busy[i]!));
      const hybrid = chooseStudySlot({
        commonSlots: [],
        conflictCounts,
        ...(open.examAt ? { examAt: open.examAt } : {}),
        memberCount: c.memberCount,
      });
      const slot = hybrid.kind === 'conflict' ? (hybrid.hybrid?.slot ?? null) : null;
      await c.emit(toConflictEvent(taskId, 'no_common_slot'));
      await c.tell('conflict', { reason: 'no_common_slot', ...(slot ? { hybrid: { slot } } : {}) });
      await c.tell('result', NONE);
      return { flow: 'study', status: 'no_slot', hybrid: slot };
    }
    tried.add(choice.slot);
    const ok = await c.confirm(
      { stage: 'proposal', chosen: choice.slot, slot: choice.slot, counts: null, rounds: round },
      choice.slot,
    );
    if (ok) {
      await c.tell('result', {
        stage: 'final',
        chosen: choice.slot,
        slot: choice.slot,
        counts: null,
      });
      return {
        flow: 'study',
        status: 'scheduled',
        slot: choice.slot,
        ...(coverage ? { coverage } : {}),
      };
    }
  }
  await c.emit(toConflictEvent(taskId, 'no_common_slot'));
  await c.tell('conflict', { reason: 'no_common_slot' });
  await c.tell('result', NONE);
  return { flow: 'study', status: 'no_slot', hybrid: null };
}
