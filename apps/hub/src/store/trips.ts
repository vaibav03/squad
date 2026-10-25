import type { Db } from '@squad/core';
import type { Directory, TripRecord, TripStore, TripView, Viewer } from '../types';
import { ensureHubSchema } from './schema';

const clone = <T>(v: T): T => structuredClone(v);

/** Trips in memory, written through to the shared sqlite on every change when `db` is given. */
export function createTripStore(db?: Db): TripStore {
  const trips = new Map<string, TripRecord>();
  const put = db?.prepare(
    'INSERT INTO hub_trips(trip_id, json) VALUES(?, ?) ON CONFLICT(trip_id) DO UPDATE SET json=excluded.json',
  );
  const persist = (t: TripRecord) => void put?.run(t.tripId, JSON.stringify(t));
  if (db) {
    ensureHubSchema(db);
    for (const r of db.prepare('SELECT json FROM hub_trips').all() as { json: string }[]) {
      const t = JSON.parse(r.json) as TripRecord;
      trips.set(t.tripId, t);
    }
  }

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
    forget(student) {
      for (const t of trips.values()) {
        const had =
          student in t.limits ||
          t.votes.some((v) => v.student === student) ||
          t.confirmations.some((c) => c.student === student);
        if (!had) continue;
        delete t.limits[student];
        t.votes = t.votes.filter((v) => v.student !== student);
        t.confirmations = t.confirmations.filter((c) => c.student !== student);
        persist(t);
      }
    },
    upsert(t) {
      const prev = trips.get(t.tripId);
      const c = clone(t) as TripRecord;
      c.limits = { ...(prev?.limits ?? {}) };
      for (const [s, l] of Object.entries(t.limits ?? {}))
        c.limits[s] = { ...(c.limits[s] ?? {}), ...l };
      if (prev && t.votes.length === 0) c.votes = prev.votes;
      ensureRows(c);
      trips.set(c.tripId, c);
      persist(c);
    },
    mergeLimits(tripId, student, limits) {
      const t = trips.get(tripId);
      if (!t) return false;
      t.limits[student] = { ...(t.limits[student] ?? {}), ...limits };
      ensureRows(t);
      persist(t);
      return true;
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
      persist(t);
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
      persist(t);
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
      const voted = new Set(t.votes.map((v) => v.student)).size;
      const mineVote = t.votes.find((v) => v.student === viewer.studentId)?.ranking;
      const mine = t.limits[viewer.studentId];
      return {
        tripId: t.tripId,
        taskId: t.taskId,
        status: t.status,
        options: clone(t.options),
        dates: t.dates,
        myVote: mineVote ? [...mineVote] : null,
        voteProgress: small ? null : { voted, of: members(t).length },
        vetoed: clone(t.vetoed),
        confirmations: t.confirmations.map((c) => ({ student: c.student, confirmed: c.confirmed })),
        myLimits: mine && !viewer.projector ? { ...mine } : null,
      };
    },
    clear() {
      trips.clear();
      db?.exec('DELETE FROM hub_trips');
    },
  };
}
