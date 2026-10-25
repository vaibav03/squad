import type { Directory, TripRecord, TripStore, TripView, Viewer } from '../types';

const clone = <T>(v: T): T => structuredClone(v);

export function createTripStore(): TripStore {
  const trips = new Map<string, TripRecord>();

  /** Members of a trip = union of limits keys, confirmation rows and voters. */
  const members = (t: TripRecord): string[] => [
    ...new Set([
      ...Object.keys(t.limits),
      ...t.confirmations.map((c) => c.student),
      ...t.votes.map((v) => v.student),
    ]),
  ];

  const ensureRows = (t: TripRecord) => {
    for (const s of members(t))
      if (!t.confirmations.some((c) => c.student === s))
        t.confirmations.push({ student: s, confirmed: false });
  };

  const recompute = (t: TripRecord) => {
    const yes = t.confirmations.filter((c) => c.confirmed);
    const opt = yes[0]?.optionId;
    const unanimous =
      t.confirmations.length > 0 &&
      yes.length === t.confirmations.length &&
      yes.every((c) => c.optionId === opt);
    if (unanimous) t.status = 'confirmed';
    else if (t.confirmations.some((c) => c.confirmed || c.optionId !== undefined))
      t.status = 'confirming';
  };

  return {
    upsert(t) {
      const c = clone(t);
      ensureRows(c);
      trips.set(c.tripId, c);
    },
    get: (id) => (trips.has(id) ? clone(trips.get(id)!) : undefined),
    byTask(taskId) {
      const t = [...trips.values()].find((x) => x.taskId === taskId);
      return t ? clone(t) : undefined;
    },
    list: (squadId) =>
      [...trips.values()].filter((t) => !squadId || t.squadId === squadId).map(clone),
    vote(tripId, student, ranking) {
      const t = trips.get(tripId);
      if (!t) return undefined;
      const ids = new Set(t.options.map((o) => o.id));
      if (ranking.some((r) => !ids.has(r))) return undefined;
      t.votes = [
        ...t.votes.filter((v) => v.student !== student),
        { student, ranking: [...ranking] },
      ];
      ensureRows(t);
      if (t.status === 'planning') t.status = 'voting';
      return clone(t);
    },
    confirm(tripId, student, optionId, yes) {
      const t = trips.get(tripId);
      if (!t) return undefined;
      const row = t.confirmations.find((c) => c.student === student);
      if (row) {
        row.confirmed = yes;
        row.optionId = optionId;
      } else t.confirmations.push({ student, confirmed: yes, optionId });
      if (t.status !== 'confirmed') t.status = 'confirming';
      recompute(t);
      return clone(t);
    },
    allConfirmed(tripId) {
      const t = trips.get(tripId);
      if (!t || t.confirmations.length === 0) return false;
      return t.confirmations.every((c) => c.confirmed);
    },
    view(tripId, viewer: Viewer, ctx: { directory: Directory }): TripView | null {
      const t = trips.get(tripId);
      if (!t || t.squadId !== viewer.squadId) return null;
      const small = ctx.directory.isSmall(viewer.squadId);
      const open = t.status === 'confirming' || t.status === 'confirmed';
      const votes = small
        ? null
        : open
          ? clone(t.votes)
          : clone(t.votes.filter((v) => v.student === viewer.studentId));
      let tallies: Record<string, number> | null = null;
      if (!small && open) {
        tallies = Object.fromEntries(t.options.map((o) => [o.id, 0]));
        for (const v of t.votes)
          v.ranking.forEach(
            (id, i) => (tallies![id] = (tallies![id] ?? 0) + (t.options.length - i)),
          );
      }
      const mine = t.limits[viewer.studentId];
      return {
        tripId: t.tripId,
        taskId: t.taskId,
        status: t.status,
        options: clone(t.options),
        dates: t.dates,
        votes,
        tallies,
        vetoed: clone(t.vetoed),
        confirmations: t.confirmations.map((c) => ({ student: c.student, confirmed: c.confirmed })),
        myLimits: mine && !viewer.projector ? { ...mine } : null,
      };
    },
    clear: () => trips.clear(),
  };
}
