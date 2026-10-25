// Trip flow coordinator (mediator side). See PROTOCOL.md step 5.
import { toConflictEvent, toOptionDroppedEvent } from '../ledger';
import { filterOptions, splitEvenly, tallyBorda, venmoLink } from '../mediator';
import { optionsOf } from './hooks';
import { earliestRun } from './time';
import type { Coord, FlowOutcome } from './types';

const NONE = { stage: 'none' as const, chosen: null, counts: null };

/**
 * Constraints only (collaborative trips): the hub owns options, ballots and confirmation, so the mesh only answers
 * what the group's private inputs can answer without revealing them: do free days overlap (PSI), and which options
 * does nobody's budget or veto rule out (secret-shared sums, aggregate only). Nothing is published to the hub from here
 * except each member's own limits; the coordinator stands everyone down at the end.
 */
export async function runTripConstraints(c: Coord): Promise<FlowOutcome> {
  const { taskId, open } = c;
  const ids = optionsOf(open).map((o) => o.id);
  const stand = async () => {
    try {
      await c.tell('result', NONE);
    } catch {
      /* a peer dropped; the task times out there */
    }
  };
  if (ids.length === 0) {
    await stand();
    return { flow: 'trip', status: 'no_plan', reason: 'no_option' };
  }
  await c.runPsi();
  const common = [...c.view().common].sort();
  const cantAfford = await c.sum('cantAfford', 0);
  const veto = await c.sum('veto', 0);
  const { survivors, dropped } = filterOptions({
    optionIds: ids,
    cantAfford,
    veto,
    memberCount: c.memberCount,
  });
  for (const d of dropped) await c.emit(toOptionDroppedEvent(taskId, d.reason));
  await stand();
  return {
    flow: 'trip',
    status: 'constraints',
    common,
    survivors,
    dropped: dropped.map((d) => ({ optionId: d.optionId, reason: d.reason })),
  };
}

export async function runTrip(c: Coord): Promise<FlowOutcome> {
  const { taskId, open } = c;
  const opts = optionsOf(open);
  const ids = opts.map((o) => o.id);
  const stop = async (
    reason: 'no_option' | 'no_plan',
    why: 'no_option' | 'declined' | 'no_dates',
  ): Promise<FlowOutcome> => {
    await c.emit(toConflictEvent(taskId, reason));
    await c.tell('conflict', { reason });
    await c.tell('result', NONE);
    return { flow: 'trip', status: 'no_plan', reason: why };
  };
  if (opts.length === 0) return stop('no_option', 'no_option');

  await c.runPsi();
  const common = c.view().common;

  const cantAfford = await c.sum('cantAfford', 0);
  const veto = await c.sum('veto', 0);
  const vetoed: { optionId: string; by: 'mediator'; reason: string }[] = [];
  const { survivors, dropped } = filterOptions({
    optionIds: ids,
    cantAfford,
    veto,
    memberCount: c.memberCount,
  });
  for (const d of dropped) {
    await c.emit(toOptionDroppedEvent(taskId, d.reason));
    vetoed.push({
      optionId: d.optionId,
      by: 'mediator',
      reason: d.reason === 'budget' ? 'option dropped: budget' : 'dropped: veto',
    });
    await c.tell('option_dropped', d);
  }
  await c.trip({ vetoed, status: 'voting' });
  if (survivors.length === 0) return stop('no_option', 'no_option');

  const borda = await c.sum('borda', 0);
  const { top2 } = tallyBorda({ optionIds: survivors, totals: borda, memberCount: c.memberCount });
  await c.tell('result', { stage: 'candidates', chosen: null, candidates: top2, counts: null });
  const noTotals = await c.sum('simulate', 0);
  const viable = top2.filter((_, k) => (noTotals[k] ?? 1) === 0);
  if (viable.length === 0) return stop('no_plan', common.length === 0 ? 'no_dates' : 'declined');

  let round = 0;
  for (const optionId of viable) {
    round++;
    const o = opts.find((x) => x.id === optionId)!;
    const dates = earliestRun(common, o.days);
    if (!dates) continue;
    const proposal = {
      stage: 'proposal' as const,
      chosen: optionId,
      dates,
      perPerson: o.perPerson,
      counts: null,
      rounds: round,
    };
    await c.trip({
      dates: `${dates[0]} to ${dates.at(-1)}`,
      status: 'confirming',
      confirmations: c.members.map((m) => ({ student: m, confirmed: false, optionId })),
    });
    if (!(await c.confirm(proposal, optionId))) continue;

    // Every student said yes: the only place trip.confirmed is emitted.
    await c.trip({ status: 'confirmed' });
    await c.emit({ t: 'trip.confirmed', taskId, squadId: open.squadId ?? taskId });
    const cents = splitEvenly(o.perPerson * 100 * c.memberCount, c.members);
    const venmo = c.members
      .filter((m) => m !== c.self)
      .map((m) =>
        venmoLink({ payee: c.venmoOf(), amountCents: cents[m]!, note: `${o.label} trip` }),
      );
    try {
      await c.tell('result', {
        stage: 'final',
        chosen: optionId,
        dates,
        perPerson: o.perPerson,
        venmo,
        counts: null,
      });
    } catch {
      /* a peer dropped after confirming; the plan stands */
    }
    return { flow: 'trip', status: 'confirmed', optionId, dates, perPerson: o.perPerson, venmo };
  }
  return stop('no_plan', 'declined');
}
