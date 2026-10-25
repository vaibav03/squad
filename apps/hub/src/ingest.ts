import { VillageEventSchema, parseAgentId, type LedgerEntry, type VillageEvent } from '@squad/core';
import { z } from 'zod';
import { ensureHubSchema } from './store/schema';
import type { HubDeps, IngestResult, Ingestor, TripRecord } from './types';

const Str = z.string().min(1);
const LedgerPrivate = z.strictObject({
  taskId: Str,
  student: Str,
  field: Str,
  shared: z.string(),
  withheld: z.string().optional(),
  ts: z.number(),
});
const TripUpsert = z.strictObject({
  tripId: Str,
  taskId: Str,
  squadId: Str,
  status: z.enum(['planning', 'voting', 'confirming', 'confirmed']),
  options: z.array(z.strictObject({ id: Str, label: z.string(), estCost: z.string().optional() })),
  dates: z.string().nullable(),
  votes: z.array(z.strictObject({ student: Str, ranking: z.array(Str) })),
  vetoed: z.array(z.strictObject({ optionId: Str, by: z.literal('mediator'), reason: z.string() })),
  confirmations: z.array(
    z.strictObject({ student: Str, confirmed: z.boolean(), optionId: z.string().optional() }),
  ),
  limits: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});
const TripLimits = z.strictObject({
  tripId: Str,
  student: Str,
  limits: z.record(z.string(), z.string()),
});
const TripTouch = z.strictObject({ tripId: Str });
const IngestProgress = z.strictObject({
  student: Str,
  courseId: Str,
  file: z.string(),
  status: z.enum(['queued', 'parsing', 'embedding', 'ready', 'failed']),
  pct: z.number().min(0).max(100).optional(),
});
const PersonaSpeaking = z.strictObject({
  agent: Str,
  speaking: z.boolean(),
  callId: z.string().optional(),
});
const SquadSettingsX = z.strictObject({
  squadId: Str,
  revealQuizCorrectness: z.boolean().optional(),
});

/** Issues carry only a path and a code, never the received value (a rejected body may hold withheld text). */
function issues(err: z.ZodError): { path: string; code: string }[] {
  return err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.') || '(root)', code: i.code }));
}
const bad = (path: string, code: string): IngestResult => ({ ok: false, issues: [{ path, code }] });

export function createIngestor(deps: HubDeps): Ingestor {
  // trip.confirmed is published at most once per task, also across restarts (persisted).
  ensureHubSchema(deps.db);
  const confirmedTasks = new Set<string>(
    (deps.db.prepare('SELECT task_id FROM hub_confirmed_tasks').all() as { task_id: string }[]).map(
      (r) => r.task_id,
    ),
  );
  const markConfirmed = (taskId: string) => {
    confirmedTasks.add(taskId);
    deps.db.prepare('INSERT OR IGNORE INTO hub_confirmed_tasks(task_id) VALUES(?)').run(taskId);
  };

  const studentOf = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    const a = parseAgentId(id);
    return a.kind === 'student' ? a.ref : undefined;
  };

  function routeSquad(e: VillageEvent): string | null {
    if (e.t === 'trip.confirmed') return e.squadId;
    // live discussion events belong to the run's squad (never broadcast to every squad)
    if (e.t.startsWith('discussion.'))
      return deps.live?.get((e as { discussionId: string }).discussionId)?.squadId ?? '__none__';
    const cand: (string | undefined)[] = [];
    if ('student' in e) cand.push(e.student);
    if ('target' in e) cand.push(e.target);
    if ('agent' in e) cand.push(studentOf(e.agent));
    if ('from' in e) cand.push(studentOf(e.from));
    if ('to' in e) cand.push(studentOf(e.to));
    if ('member' in e) cand.push(studentOf(e.member));
    for (const s of cand) {
      const sq = s ? deps.directory.squadOf(s) : undefined;
      if (sq) return sq;
    }
    return null;
  }

  function commit(
    kind: 'village' | 'x',
    type: string,
    payload: unknown,
    squadId: string | null,
  ): IngestResult {
    const logged = deps.events.append({ kind, type, payload, squadId });
    deps.state.apply(logged);
    deps.broker.publish(logged);
    deps.log.debug('event accepted', { type, seq: logged.seq, squadId });
    return { ok: true, seq: logged.seq };
  }

  return {
    reset() {
      confirmedTasks.clear();
      deps.db.exec('DELETE FROM hub_confirmed_tasks');
    },
    village(input) {
      const parsed = VillageEventSchema.safeParse(input);
      if (!parsed.success) return { ok: false, issues: issues(parsed.error) };
      const e = parsed.data;
      if (e.t === 'trip.confirmed') {
        if (confirmedTasks.has(e.taskId))
          return { ok: true, seq: null, dropped: 'duplicate_trip_confirmed' };
        const trip = deps.trips.byTask(e.taskId);
        if (trip && !deps.trips.allConfirmed(trip.tripId))
          return { ok: true, seq: null, dropped: 'trip_not_complete' };
        markConfirmed(e.taskId);
      }
      if (e.t === 'call.start') deps.calls.noteOwner(e.callId, e.student ?? null);
      const squadId = routeSquad(e);
      const res = commit('village', e.t, e, squadId);
      if (e.t === 'ledger.entry') deps.ledger.recordPublic(e, deps.now());
      return res;
    },

    x(type, data) {
      switch (type) {
        case 'x.ledger.private': {
          const p = LedgerPrivate.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          const entry: LedgerEntry = { ...p.data };
          deps.ledger.addPrivate(entry);
          return { ok: true, seq: null }; // stored privately, never logged or broadcast
        }
        case 'x.trip.upsert': {
          const p = TripUpsert.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          deps.trips.upsert(
            p.data as Omit<TripRecord, 'limits'> & { limits?: TripRecord['limits'] },
          );
          return commit('x', 'x.trip.updated', { tripId: p.data.tripId }, p.data.squadId);
        }
        case 'x.trip.limits': {
          const p = TripLimits.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          // A collaborative trip's constraint runs post limits under the run's task id.
          const t = deps.trips.get(p.data.tripId) ?? deps.trips.byTask(p.data.tripId);
          if (!t || !deps.trips.mergeLimits(t.tripId, p.data.student, p.data.limits))
            return bad('tripId', 'unknown_trip');
          return commit('x', 'x.trip.updated', { tripId: t.tripId }, t.squadId);
        }
        case 'x.trip.touch': {
          const p = TripTouch.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          const t = deps.trips.get(p.data.tripId);
          if (!t) return bad('tripId', 'unknown_trip');
          return commit('x', 'x.trip.updated', { tripId: t.tripId }, t.squadId);
        }
        case 'x.ingest.progress': {
          const p = IngestProgress.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          return commit('x', type, p.data, deps.directory.squadOf(p.data.student) ?? null);
        }
        case 'x.persona.speaking': {
          const p = PersonaSpeaking.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          const s = studentOf(p.data.agent);
          return commit('x', type, p.data, s ? (deps.directory.squadOf(s) ?? null) : null);
        }
        case 'x.squad.settings': {
          const p = SquadSettingsX.safeParse(data);
          if (!p.success) return { ok: false, issues: issues(p.error) };
          if (!deps.directory.squad(p.data.squadId)) return bad('squadId', 'unknown_squad');
          const next = deps.directory.setSettings(p.data.squadId, {
            ...(p.data.revealQuizCorrectness !== undefined
              ? { revealQuizCorrectness: p.data.revealQuizCorrectness }
              : {}),
          });
          return commit('x', type, { squadId: p.data.squadId, ...next }, p.data.squadId);
        }
        default:
          return bad('type', 'unknown_type');
      }
    },
  };
}
