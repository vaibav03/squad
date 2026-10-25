import type { TripViewV2 } from '@squad/core';
import type { Directory, TripRecord, Viewer } from '../types';
import { MIN_GROUP } from './limits';
import { fmtDays, money } from './logic';

const ACTIVE = new Set(['planning', 'voting', 'confirming']);

export const isActive = (t: TripRecord, now = Date.now()): boolean =>
  ACTIVE.has(t.status) && !(t.collab && now > t.collab.deadline);

/** Member ids of a trip: confirmation rows + voters + limits owners (legacy), plus squad members while open (collab). */
export function tripMembers(t: TripRecord): string[] {
  return [
    ...new Set([
      ...t.confirmations.map((c) => c.student),
      ...t.votes.map((v) => v.student),
      ...Object.keys(t.limits),
    ]),
  ];
}

/**
 * The one per-viewer projection of a trip (REST and `x.trip.updated`). The ballot is secret: only the viewer's own
 * ranking, participation and counts only from 3 voters up (and only for squads of 3+), calendars only as shared free
 * days, limits only to their owner.
 */
export function buildTripView(
  t: TripRecord,
  viewer: Viewer,
  ctx: { directory: Directory; now?: number },
): TripViewV2 | null {
  if (t.squadId !== viewer.squadId) return null;
  const now = ctx.now ?? Date.now();
  const c = t.collab;
  const nameOf = (id: string) => ctx.directory.student(id)?.name ?? id;
  const status = c && ACTIVE.has(t.status) && now > c.deadline ? ('expired' as const) : t.status;
  const ids = tripMembers(t);
  const voters = new Set(t.votes.map((v) => v.student));
  const small = ctx.directory.isSmall(viewer.squadId);
  const showPart = !small && voters.size >= MIN_GROUP;
  const me = viewer.studentId;
  const mine = t.limits[me];
  const myRow = t.confirmations.find((r) => r.student === me);
  const opts = t.options.map((o) => {
    const meta = c?.optionMeta[o.id];
    const dropped = t.vetoed.find((v) => v.optionId === o.id);
    const perPerson = meta?.perPerson ?? o.perPerson;
    return {
      id: o.id,
      label: o.label,
      ...(o.estCost !== undefined ? { estCost: o.estCost } : perPerson !== undefined ? { estCost: money(perPerson) } : {}),
      ...(meta?.days ?? o.days ? { days: meta?.days ?? o.days } : {}),
      ...(perPerson !== undefined ? { perPerson } : {}),
      ...(meta ? { proposedBy: meta.by, proposedByName: meta.by === 'council' ? 'Council' : nameOf(meta.by), rev: meta.rev } : {}),
      ...(dropped ? { droppedReason: dropped.reason } : {}),
    };
  });
  const rowOption = t.confirmations.find((r) => r.optionId)?.optionId;
  const chosen = c
    ? c.chosen
    : t.status === 'confirming' && rowOption
      ? { optionId: rowOption, dates: t.dates }
      : null;
  const isOrg = c ? c.organizer === me : false;
  const voting = status === 'voting';
  const open = status === 'planning' || status === 'voting';
  const waiting = c?.constraints.state === 'waiting' || c?.constraints.state === 'failed';
  const constraints = c
    ? {
        state: c.constraints.state,
        waitingFor: c.constraints.waitingFor.map((w) => ({ id: w.id, name: nameOf(w.id), reason: w.reason })),
        overlapDays: c.constraints.overlapDays,
        note: c.constraints.note,
        checkedAt: c.constraints.checkedAt,
      }
    : { state: 'done' as const, waitingFor: [], overlapDays: null, note: null, checkedAt: null };
  return {
    tripId: t.tripId,
    taskId: t.taskId,
    status,
    title: c?.title ?? 'Group trip',
    organizer: c?.organizer ?? null,
    source: c?.source ?? 'seed',
    rev: c?.rev ?? 0,
    window: c?.window ?? null,
    deadline: c?.deadline ?? null,
    options: opts,
    dates: t.dates,
    chosen,
    myVote: t.votes.find((v) => v.student === me)?.ranking ?? null,
    voteProgress: !small && voters.size >= MIN_GROUP ? { voted: voters.size, of: ids.length } : null,
    members: ids.map((id) => {
      const row = t.confirmations.find((r) => r.student === id);
      const ag = c?.agents[id]?.state ?? 'unknown';
      return {
        id,
        name: nameOf(id),
        isOrganizer: c?.organizer === id,
        agent: ag,
        confirmed: row?.confirmed ?? false,
        declined: c?.declined.includes(id) ?? false,
        voted: id === me ? voters.has(id) : showPart ? voters.has(id) : null,
      };
    }),
    confirmations: t.confirmations.map((r) => ({ student: r.student, confirmed: r.confirmed })),
    vetoed: t.vetoed.map((v) => ({ optionId: v.optionId, by: v.by, reason: v.reason })),
    myLimits: mine && !viewer.projector ? { ...mine } : null,
    constraints,
    recommendation: c?.recommendation
      ? { ...c.recommendation, at: c.recommendation.at }
      : null,
    changes: (c?.changes ?? []).slice(-12).map((ch) => ({ ...ch, byName: nameOf(ch.by) })),
    failure: c?.failure ?? (status === 'expired' ? { code: 'expired', message: 'The voting deadline passed before everyone confirmed. The organizer can reopen it.' } : null),
    can: {
      propose: !!c && open,
      vote: voting && ids.includes(me) && (!c || true),
      confirm: status === 'confirming' && !!myRow && !myRow.confirmed,
      closeVoting: !!c && voting && isOrg && voters.size > 0,
      retry: !!c && open && !!waiting && ids.includes(me),
      continueWithout: !!c && open && isOrg && !!waiting,
      reopen: !!c && isOrg && (status === 'failed' || status === 'expired'),
      cancel: !!c && isOrg && ACTIVE.has(status),
    },
  };
}

export { fmtDays };
