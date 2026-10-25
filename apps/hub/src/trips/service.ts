// Collaborative trip planning: the hub owns the trip (options, ballots, confirmation); the mesh only answers what the
// group's private inputs can answer without revealing them (overlap + budget/veto aggregates).
// docs/trip-planning.md is the spec of the rules implemented here.
import type { TripViewV2 } from '@squad/core';
import type { HubDeps, TripCollab, TripRecord, Viewer } from '../types';
import { createTripAgents, type TripAgents } from './agents';
import {
  CATALOG,
  DAY_MS,
  DEFAULT_DEADLINE_MS,
  MAX_WINDOW_DAYS,
  defaultWindow,
  earliestRun,
  fmtDays,
  fmtRange,
  money,
  monthWindow,
  recommend,
  slug,
  tally,
} from './logic';
import { handleTripChat } from './chat';
import { MIN_GROUP } from './limits';
import { buildTripView, isActive } from './view';

export type Fail = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 422;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
};
export type Res<T = TripViewV2> = { ok: true; trip: T } | Fail;
const fail = (
  status: Fail['status'],
  code: string,
  message: string,
  extra?: Fail['extra'],
): Fail => ({
  ok: false,
  status,
  code,
  message,
  ...(extra ? { extra } : {}),
});

export type AskMember = (
  student: string,
  question: string,
  options: string[],
  taskId: string,
) => Promise<string>;
export type Narrate = (prompt: string) => Promise<string>;

export interface TripService {
  agents: TripAgents;
  setAgentUrls(urls: Record<string, string>): void;
  setAsk(fn: AskMember | undefined, cancel?: (student: string, taskId: string) => void): void;
  setNarrator(n: { narrate: Narrate; real: () => boolean } | undefined): void;
  /** Runs before each constraint check so connection-derived busy blocks (Canvas/Google, titles never stored) are current. */
  setBeforeConstraints(fn: ((members: string[]) => Promise<void> | void) | undefined): void;
  current(v: Viewer): TripViewV2 | null;
  list(v: Viewer): { tripId: string; title: string; status: string }[];
  get(v: Viewer, id: string): TripViewV2 | null;
  create(v: Viewer, body: CreateBody, source: 'chat' | 'page'): Promise<Res>;
  addOption(v: Viewer, id: string, body: { label: string; days?: number; perPerson?: number }): Res;
  editOption(
    v: Viewer,
    id: string,
    optionId: string,
    body: { baseRev: number; label?: string; days?: number; perPerson?: number; replace?: boolean },
  ): Res;
  removeOption(
    v: Viewer,
    id: string,
    optionId: string,
    baseRev: number | undefined,
    replace?: boolean,
  ): Res;
  vote(v: Viewer, id: string, body: { ranking: string[]; baseRev?: number }): Res;
  confirm(v: Viewer, id: string, body: { optionId?: string; yes: boolean; baseRev?: number }): Res;
  closeVoting(v: Viewer, id: string): Res;
  retry(v: Viewer, id: string): Promise<Res>;
  continueWithout(v: Viewer, id: string): Res;
  reopen(v: Viewer, id: string): Res;
  cancel(v: Viewer, id: string): Res;
  /** Expire overdue trips, refresh agent health, resume trips waiting on an agent. */
  sweep(): Promise<void>;
  /** Resolves when background constraint runs started so far are done (tests, e2e probes). */
  idle(): Promise<void>;
  /** Chat text -> a trip action; true when handled (the caller must not route the text to the bot). */
  handleChat(v: Viewer, chatId: string, text: string): Promise<boolean>;
  stop(): void;
}
export interface CreateBody {
  destination: string;
  from?: string | undefined;
  to?: string | undefined;
  month?: number | undefined;
  days?: number | undefined;
  perPerson?: number | undefined;
}

const rid = () => Math.random().toString(36).slice(2, 10);
const ACTIVE = ['planning', 'voting', 'confirming'];

export function createTripService(
  deps: HubDeps,
  o: { agents?: TripAgents; sweepMs?: number } = {},
): TripService {
  const agents = o.agents ?? createTripAgents({ secret: () => deps.config.internalSecret });
  const nameOf = (id: string) => deps.directory.student(id)?.name ?? id;
  const now = () => deps.now();
  let ask: AskMember | undefined;
  let cancelAsk: ((student: string, taskId: string) => void) | undefined;
  let narr: { narrate: Narrate; real: () => boolean } | undefined;
  let before: ((members: string[]) => Promise<void> | void) | undefined;
  const chains = new Map<string, Promise<void>>();
  let timer: ReturnType<typeof setInterval> | undefined;
  const lastRetry = new Map<string, number>();
  /** `tripId|student` of vote cards still waiting for an answer (one at a time per member). */
  const outstanding = new Set<string>();

  const view = (t: TripRecord, v: Viewer) =>
    buildTripView(t, v, { directory: deps.directory, now: now() });
  const touch = (t: TripRecord) => void deps.ingest.x('x.trip.touch', { tripId: t.tripId });
  const save = (t: TripRecord) => {
    deps.trips.put(t);
    touch(t);
  };
  const squadMembers = (squadId: string) => deps.directory.members(squadId).map((s) => s.id);

  /** Plain-text card into the squad group chat. It is a normal hub chat message, so the iMessage bridge mirrors it too. */
  const mirror = (t: TripRecord, text: string) => {
    deps.chat.postBot({
      chatId: `group:${t.squadId}`,
      personaId: 'cubbie',
      personaName: 'Cubbie',
      text: `Trip: ${t.collab?.title ?? 'Group trip'}\n${text}\nOpen the Trip page in Squad: /squad/trips/${t.tripId}`,
      citations: [],
      attachments: [],
    });
  };
  const log = (t: TripRecord, by: string, summary: string, optionId?: string) => {
    const c = t.collab!;
    c.changes.push({ rev: c.rev, by, at: now(), summary, ...(optionId ? { optionId } : {}) });
    if (c.changes.length > 50) c.changes.splice(0, c.changes.length - 50);
  };
  const bump = (t: TripRecord) => ++t.collab!.rev;

  const load = (v: Viewer, id: string): { t: TripRecord } | Fail => {
    const t = deps.trips.get(id) ?? deps.trips.byTask(id);
    if (!t || t.squadId !== v.squadId) return fail(404, 'not_found', 'No such trip in your squad.');
    if (!t.collab)
      return fail(
        422,
        'legacy_trip',
        'This trip was created by the demo agents and cannot be edited here.',
      );
    return { t };
  };
  const expireIfDue = (t: TripRecord): boolean => {
    const c = t.collab;
    if (!c || !ACTIVE.includes(t.status) || now() <= c.deadline) return false;
    t.status = 'expired';
    dropCards(t, 'vote');
    dropCards(t, 'confirm');
    c.failure = {
      code: 'expired',
      message: 'The deadline passed before everyone confirmed. The organizer can reopen it.',
    };
    return true;
  };
  const optsPublic = (t: TripRecord) =>
    t.options.map((o) => {
      const m = t.collab!.optionMeta[o.id]!;
      return { id: o.id, label: o.label, days: m.days, perPerson: m.perPerson };
    });
  const live = (t: TripRecord) =>
    t.options.filter((o) => !t.vetoed.some((x) => x.optionId === o.id));
  const perOf = (t: TripRecord) => (id: string) => t.collab?.optionMeta[id]?.perPerson ?? 0;

  const syncMembers = (t: TripRecord) => {
    if (!['planning', 'voting'].includes(t.status)) return;
    for (const m of squadMembers(t.squadId))
      if (!t.confirmations.some((c) => c.student === m))
        t.confirmations.push({ student: m, confirmed: false });
  };

  // ---------- recommendation ----------
  function setReco(t: TripRecord): void {
    const c = t.collab!;
    const voters = new Set(t.votes.map((x) => x.student)).size;
    const small = deps.directory.isSmall(t.squadId);
    const leader = !small && voters >= MIN_GROUP ? (tally(t, perOf(t))[0]?.optionId ?? null) : null;
    const skippedFor =
      c.constraints.state === 'skipped' ? c.constraints.waitingFor.map((w) => nameOf(w.id)) : [];
    const base = recommend({
      options: optsPublic(t),
      droppedIds: t.vetoed.map((x) => x.optionId),
      overlap: c.constraints.overlapDays,
      leader,
      skippedFor,
    });
    const real = narr?.real() ?? false;
    c.recommendation = {
      optionId: base.optionId,
      mode: real ? 'degraded' : 'demo',
      chair: base.chair,
      planner: base.planner,
      dissent: base.dissent,
      at: now(),
    };
    if (real && narr) {
      const tripId = t.tripId;
      const stamp = c.recommendation.at;
      const prompt = `Rewrite these two council lines for a student group chat, each under 25 words, friendly, no new facts, keep every number and name. Reply as JSON {"chair":"...","planner":"..."}.\nchair: ${base.chair}\nplanner: ${base.planner}`;
      void (async () => {
        let next: { chair: string; planner: string; mode: 'live' | 'degraded' } | undefined;
        try {
          const raw = await Promise.race([
            narr!.narrate(prompt),
            new Promise<string>((_, rej) =>
              setTimeout(() => rej(new Error('timeout')), 8000).unref?.(),
            ),
          ]);
          const j = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '{}') as {
            chair?: string;
            planner?: string;
          };
          if (j.chair && j.planner && narr!.real())
            next = { chair: j.chair.slice(0, 300), planner: j.planner.slice(0, 300), mode: 'live' };
        } catch {
          /* stays degraded: the rules text above is still true */
        }
        const cur = deps.trips.get(tripId);
        if (!next || !cur?.collab?.recommendation || cur.collab.recommendation.at !== stamp) return;
        Object.assign(cur.collab.recommendation, next);
        save(cur);
      })();
    }
  }

  // ---------- constraints (mesh) ----------
  async function refreshAgents(t: TripRecord): Promise<string[]> {
    const c = t.collab!;
    const ids = squadMembers(t.squadId);
    const states = await Promise.all(ids.map(async (id) => [id, await agents.health(id)] as const));
    const off: string[] = [];
    for (const [id, st] of states) {
      const prev = c.agents[id];
      if (!prev || prev.state !== st) c.agents[id] = { state: st, since: now() };
      if (st !== 'online') off.push(id);
    }
    return off;
  }

  function enqueue(tripId: string, job: () => Promise<void>): void {
    const prev = chains.get(tripId) ?? Promise.resolve();
    const next = prev
      .then(job)
      .catch((e) => deps.log.error('trip job failed', { err: (e as Error).name }));
    chains.set(tripId, next);
  }

  function runConstraints(tripId: string): void {
    enqueue(tripId, async () => {
      let t = deps.trips.get(tripId);
      if (!t?.collab || !['planning', 'voting'].includes(t.status)) return;
      const c = t.collab;
      c.constraints = { ...c.constraints, state: 'running', note: null };
      save(t);
      const members = squadMembers(t.squadId);
      if (members.length < 2) {
        t = deps.trips.get(tripId)!;
        t.collab!.constraints = {
          state: 'skipped',
          waitingFor: [],
          overlapDays: null,
          note: 'Only you are in the squad so far. Invite members, then retry.',
          checkedAt: now(),
        };
        openVoting(t, 'Only one member so far, so there is nothing to compare yet.');
        return;
      }
      const off = await refreshAgents(t);
      t = deps.trips.get(tripId)!;
      t.collab!.agents = { ...t.collab!.agents, ...c.agents };
      if (off.length) {
        const prevWait = t.collab!.constraints.waitingFor.map((w) => w.id).join(',');
        t.collab!.constraints = {
          state: 'waiting',
          waitingFor: off.map((id) => ({
            id,
            reason: c.agents[id]?.state === 'no_agent' ? 'no_agent' : 'offline',
          })),
          overlapDays: null,
          note: waitNote(off, c.agents),
          checkedAt: null,
        };
        save(t);
        if (prevWait !== off.join(','))
          mirror(
            t,
            `${waitNote(off, c.agents)}. Nothing is checked until they are back, or ${nameOf(t.collab!.organizer)} continues without them.`,
          );
        return;
      }
      try {
        await before?.(members);
      } catch (e) {
        deps.log.warn('trip: busy-block refresh failed', { err: (e as Error).name });
      }
      t = deps.trips.get(tripId)!;
      const runId = `${tripId}.r${t.collab!.runs.length + 1}`;
      t.collab!.runs.push(runId);
      save(t);
      const coordinator = t.collab!.organizer;
      const res = await agents.start(coordinator, {
        taskId: runId,
        members,
        window: t.collab!.window,
        squadId: t.squadId,
        options: optsPublic(t).map((o) => ({ ...o, label: slug(o.label) })),
      });
      t = deps.trips.get(tripId);
      if (!t?.collab || !['planning', 'voting'].includes(t.status)) return;
      applyOutcome(t, res, members);
    });
  }

  const waitNote = (ids: string[], ag: TripCollab['agents']) => {
    const n = ids.map(nameOf);
    const kinds = ids.map((id) => ag[id]?.state === 'no_agent');
    const first = n[0]!;
    return kinds[0]
      ? `${first} has no agent connected yet, trip waits for ${first}${n.length > 1 ? ` and ${n.length - 1} more` : ''}`
      : `${first}'s agent is offline, trip waits for ${first}${n.length > 1 ? ` and ${n.length - 1} more` : ''}`;
  };

  function applyOutcome(
    t: TripRecord,
    res: Awaited<ReturnType<TripAgents['start']>>,
    members: string[],
  ): void {
    const c = t.collab!;
    if (!res.ok) {
      c.constraints = {
        state: res.reason === 'offline' ? 'waiting' : 'failed',
        waitingFor: [],
        overlapDays: null,
        note:
          res.reason === 'timeout'
            ? 'The agents did not answer in time. Retry in a moment.'
            : res.reason === 'offline'
              ? 'An agent dropped out while checking. Retry to try again.'
              : 'The agents could not finish checking. Retry in a moment.',
        checkedAt: null,
      };
      save(t);
      mirror(t, c.constraints.note!);
      return;
    }
    const out = res.outcome;
    if (out.status === 'constraints') {
      c.constraints = {
        state: 'done',
        waitingFor: [],
        overlapDays: out.common,
        note: null,
        checkedAt: now(),
      };
      t.vetoed = out.dropped.map((d) => ({
        optionId: d.optionId,
        by: 'mediator' as const,
        reason:
          d.reason === 'budget'
            ? 'Over at least one private budget'
            : 'Ruled out by at least one member',
      }));
      if (out.common.length === 0) {
        c.constraints.state = 'failed';
        c.constraints.note =
          'No day is free for everyone inside this window. Cancel and plan again with a different month.';
      } else if (out.survivors.length === 0) {
        c.constraints.state = 'failed';
        c.constraints.note =
          "Every option is over someone's budget or ruled out. Propose another option and the check re-runs.";
      }
      setReco(t);
      if (c.constraints.state === 'done') {
        openVoting(
          t,
          `Free days for all ${members.length}: ${fmtDays(out.common)}.${t.vetoed.length ? ` ${t.vetoed.length} option${t.vetoed.length === 1 ? '' : 's'} dropped by budget or a hard no (nobody is named).` : ''}`,
        );
      } else {
        save(t);
        mirror(t, c.constraints.note!);
      }
      return;
    }
    c.constraints = {
      state: 'failed',
      waitingFor: [],
      overlapDays: null,
      note:
        out.status === 'no_plan' && out.reason === 'offline'
          ? 'An agent dropped out while checking. Retry to try again.'
          : 'The agents could not finish checking. Retry in a moment.',
      checkedAt: null,
    };
    save(t);
  }

  /** planning -> voting (once), then announce and prompt every member's DM. */
  function openVoting(t: TripRecord, why: string): void {
    const c = t.collab!;
    const first = t.status === 'planning';
    if (first) {
      t.status = 'voting';
      c.constraints.state = c.constraints.state === 'skipped' ? 'skipped' : 'done';
    }
    syncMembers(t);
    setReco(t);
    save(t);
    if (!first) return;
    const list = live(t).map((o, i) => `${i + 1}. ${o.label} (${money(perOf(t)(o.id))})`);
    mirror(
      t,
      `Voting is open. ${why}\n${list.join('\n')}\nVote on the Trip page, or DM me "I vote 2". Votes are secret.`,
    );
    promptVotes(t);
  }

  /** A card whose subject is over must not keep swallowing the member's DMs: drop it. */
  function dropCards(t: TripRecord, kind: 'vote' | 'confirm'): void {
    for (const r of t.confirmations) {
      if (kind === 'vote') outstanding.delete(`${t.tripId}|${r.student}`);
      cancelAsk?.(r.student, `${t.tripId}:${kind}`);
    }
  }

  function promptVotes(t: TripRecord): void {
    if (!ask) return;
    const options = live(t);
    if (options.length < 2) return;
    for (const m of t.confirmations.map((r) => r.student)) {
      if (t.votes.some((x) => x.student === m)) continue;
      const key = `${t.tripId}|${m}`;
      if (outstanding.has(key)) continue;
      outstanding.add(key);
      void ask(
        m,
        `Trip vote: where to? Your pick is secret.`,
        options.map((o) => `${o.label} (${money(perOf(t)(o.id))})`),
        `${t.tripId}:vote`,
      )
        .then((a) => {
          if (a === 'timeout') return;
          const idx = options.findIndex((o) => a.startsWith(o.label));
          if (idx < 0) return;
          const cur = deps.trips.get(t.tripId);
          if (!cur?.collab || cur.status !== 'voting' || cur.votes.some((x) => x.student === m))
            return;
          applyVote(cur, m, [
            options[idx]!.id,
            ...options.filter((_, i) => i !== idx).map((o) => o.id),
          ]);
        })
        .catch(() => undefined)
        .finally(() => void outstanding.delete(key));
    }
  }

  function promptConfirms(t: TripRecord): void {
    if (!ask || !t.collab?.chosen) return;
    const ch = t.collab.chosen;
    const opt = t.options.find((o) => o.id === ch.optionId);
    const q = `Confirm the trip: ${opt?.label ?? ch.optionId}${ch.dates ? `, ${ch.dates}` : ''}, ${money(perOf(t)(ch.optionId))} each?`;
    for (const r of t.confirmations) {
      void ask(r.student, q, ['Confirm', 'Not for me'], `${t.tripId}:confirm`)
        .then((a) => {
          if (a === 'timeout') return;
          const cur = deps.trips.get(t.tripId);
          if (!cur?.collab || cur.status !== 'confirming') return;
          if (cur.confirmations.find((x) => x.student === r.student)?.confirmed) return;
          applyConfirm(cur, r.student, ch.optionId, a === 'Confirm');
        })
        .catch(() => undefined);
    }
  }

  // ---------- votes / confirm core ----------
  function applyVote(t: TripRecord, student: string, ranking: string[]): void {
    t.votes = [...t.votes.filter((x) => x.student !== student), { student, ranking: [...ranking] }];
    syncMembers(t);
    const voters = new Set(t.votes.map((x) => x.student)).size;
    const members = t.confirmations.length;
    setReco(t);
    save(t);
    const small = deps.directory.isSmall(t.squadId);
    mirror(
      t,
      voters >= MIN_GROUP && !small
        ? `A vote came in (${voters} of ${members} have voted). Ballots stay secret.`
        : 'A vote came in. Counts stay hidden until 3 members have voted.',
    );
    if (voters >= members) closeNow(t, 'Everyone has voted.');
  }

  function closeNow(t: TripRecord, why: string): void {
    const c = t.collab!;
    const ranked = tally(t, perOf(t));
    const top = ranked[0];
    if (!top) {
      c.failure = { code: 'no_option', message: 'No option is left to choose from.' };
      t.status = 'failed';
      dropCards(t, 'vote');
      save(t);
      mirror(t, c.failure.message);
      return;
    }
    const opt = t.options.find((o) => o.id === top.optionId)!;
    const meta = c.optionMeta[opt.id]!;
    const run = c.constraints.overlapDays
      ? earliestRun(c.constraints.overlapDays, meta.days)
      : null;
    c.chosen = { optionId: opt.id, dates: run ? fmtRange(run) : null };
    t.dates = c.chosen.dates;
    t.status = 'confirming';
    dropCards(t, 'vote');
    t.confirmations = t.confirmations.map((r) => ({
      student: r.student,
      confirmed: false,
      optionId: opt.id,
    }));
    c.declined = [];
    bump(t);
    log(t, c.organizer, `Voting closed on ${opt.label}`, opt.id);
    setReco(t);
    save(t);
    mirror(
      t,
      `${why} Voting closed: ${opt.label}${c.chosen.dates ? `, ${c.chosen.dates}` : ''}, ${money(meta.perPerson)} each. Everyone needs to confirm: say "confirm" or tap Confirm on the Trip page.`,
    );
    promptConfirms(t);
  }

  function applyConfirm(t: TripRecord, student: string, optionId: string, yes: boolean): void {
    const c = t.collab!;
    const opt = t.options.find((o) => o.id === optionId);
    const row = t.confirmations.find((r) => r.student === student);
    if (!row) return;
    if (!yes) {
      row.confirmed = false;
      if (!c.declined.includes(student)) c.declined.push(student);
      t.status = 'failed';
      dropCards(t, 'confirm');
      c.failure = {
        code: 'declined',
        message: `${nameOf(student)} can't make ${opt?.label ?? 'this option'}. The organizer can reopen voting to pick another.`,
      };
      save(t);
      mirror(t, c.failure.message);
      return;
    }
    row.confirmed = true;
    row.optionId = optionId;
    deps.ingest.village({ t: 'confirm.done', student, taskId: t.taskId, question: 'Confirm trip' });
    const all = t.confirmations.every((r) => r.confirmed);
    if (all) t.status = 'confirmed';
    if (all) dropCards(t, 'confirm');
    save(t);
    if (all) {
      deps.ingest.village({ t: 'trip.confirmed', taskId: t.taskId, squadId: t.squadId });
      mirror(
        t,
        `Trip confirmed by all ${t.confirmations.length}: ${opt?.label ?? optionId}${c.chosen?.dates ? `, ${c.chosen.dates}` : ''}, ${money(perOf(t)(optionId))} each. Watch the cutscene in the village.`,
      );
    } else {
      const left = t.confirmations.filter((r) => !r.confirmed).length;
      mirror(t, `${nameOf(student)} confirmed. Waiting for ${left} more.`);
    }
  }

  // ---------- conflict helper ----------
  function conflict(t: TripRecord, optionId: string | undefined, msg: string): Fail {
    const c = t.collab!;
    const ch =
      [...c.changes].reverse().find((x) => !optionId || x.optionId === optionId) ??
      c.changes.at(-1);
    const opt = optionId ? t.options.find((x) => x.id === optionId) : undefined;
    const meta = optionId ? c.optionMeta[optionId] : undefined;
    return fail(409, 'conflict', msg, {
      conflict: {
        rev: c.rev,
        change: ch ? { ...ch, byName: nameOf(ch.by) } : null,
        option: opt
          ? {
              id: opt.id,
              label: opt.label,
              estCost: money(meta?.perPerson ?? 0),
              days: meta?.days,
              perPerson: meta?.perPerson,
              rev: meta?.rev,
            }
          : null,
      },
    });
  }

  const optionId = (t: TripRecord, label: string) => {
    const base = slug(label);
    let id = base;
    for (let n = 2; t.options.some((o) => o.id === id); n++) id = `${base}-${n}`.slice(0, 48);
    return id;
  };
  const dup = (t: TripRecord, label: string, except?: string) =>
    t.options.some((o) => o.id !== except && o.label.toLowerCase() === label.toLowerCase());

  function rerun(t: TripRecord): void {
    if (t.collab!.constraints.state === 'done' || t.collab!.constraints.state === 'failed')
      runConstraints(t.tripId);
  }

  const svc: TripService = {
    agents,
    setAgentUrls(urls) {
      agents.setUrls(urls);
      if (!timer && (o.sweepMs ?? 15_000) > 0) {
        timer = setInterval(() => void svc.sweep(), o.sweepMs ?? 15_000);
        timer.unref?.();
      }
    },
    setAsk(fn, cancel) {
      ask = fn;
      cancelAsk = cancel;
    },
    setNarrator: (n) => void (narr = n),
    setBeforeConstraints: (fn) => void (before = fn),
    current(v) {
      const all = deps.trips.list(v.squadId);
      const collab = all
        .filter((t) => t.collab)
        .sort((a, b) => b.collab!.createdAt - a.collab!.createdAt);
      const pick = collab.find((t) => isActive(t, now())) ?? collab[0] ?? all[0];
      if (!pick) return null;
      if (expireIfDue(pick)) deps.trips.put(pick);
      return view(pick, v);
    },
    list(v) {
      return deps.trips
        .list(v.squadId)
        .map((t) => ({
          tripId: t.tripId,
          title: t.collab?.title ?? 'Group trip',
          status: t.status,
        }));
    },
    get(v, id) {
      const t = deps.trips.get(id) ?? deps.trips.byTask(id);
      if (!t) return null;
      if (expireIfDue(t)) deps.trips.put(t);
      return view(t, v);
    },

    async create(v, body, source) {
      const squadId = v.squadId;
      const active = deps.trips.list(squadId).find((t) => t.collab && isActive(t, now()));
      if (active)
        return fail(
          409,
          'trip_in_progress',
          `There is already a trip in progress: ${active.collab!.title} (${active.status}).`,
          { tripId: active.tripId },
        );
      const n = now();
      let window =
        body.from && body.to
          ? { from: body.from, to: body.to }
          : body.month
            ? monthWindow(body.month, n)
            : defaultWindow(n);
      if (body.from && !body.to)
        window = {
          from: body.from,
          to: new Date(Date.parse(`${body.from}T00:00:00Z`) + 30 * DAY_MS)
            .toISOString()
            .slice(0, 10),
        };
      const span =
        (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / DAY_MS +
        1;
      if (!(span >= 1) || span > MAX_WINDOW_DAYS)
        return fail(400, 'invalid_request', `The window must be 1 to ${MAX_WINDOW_DAYS} days.`);
      const label = body.destination.trim();
      const cat = CATALOG.find((c) => c.label.toLowerCase() === label.toLowerCase());
      const days = Math.min(body.days ?? cat?.days ?? 3, Math.max(1, span));
      const perPerson = body.perPerson ?? cat?.perPerson ?? 0;
      const tripId = `trip_${rid()}`;
      const t: TripRecord = {
        tripId,
        taskId: tripId,
        squadId,
        status: 'planning',
        options: [],
        dates: null,
        votes: [],
        vetoed: [],
        confirmations: [],
        limits: {},
        collab: {
          organizer: v.studentId,
          title: `${label}${body.month ? ` in ${new Date(Date.UTC(2000, body.month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}` : ''}`,
          source,
          createdAt: n,
          deadline: n + DEFAULT_DEADLINE_MS,
          window,
          rev: 1,
          optionMeta: {},
          changes: [],
          constraints: {
            state: 'pending',
            waitingFor: [],
            overlapDays: null,
            note: null,
            checkedAt: null,
          },
          runs: [],
          agents: {},
          chosen: null,
          recommendation: null,
          failure: null,
          declined: [],
        },
      };
      const add = (lbl: string, by: string, d: number, p: number, est: boolean) => {
        const id = optionId(t, lbl);
        t.options.push({
          id,
          label: lbl,
          estCost: est ? `${money(p)} est.` : money(p),
          days: d,
          perPerson: p,
        });
        t.collab!.optionMeta[id] = { by, rev: 1, days: d, perPerson: p };
      };
      add(label, v.studentId, days, perPerson, !body.perPerson && !!cat);
      for (const c of CATALOG.filter((x) => x.label.toLowerCase() !== label.toLowerCase()).slice(
        0,
        2,
      ))
        add(c.label, 'council', Math.min(c.days, Math.max(1, span)), c.perPerson, true);
      syncMembers(t);
      log(t, v.studentId, `Started the plan for ${label}`);
      deps.trips.put(t);
      touch(t);
      mirror(
        t,
        `${nameOf(v.studentId)} started a trip plan for ${label}, ${fmtRange([window.from, window.to])} window. Council added ${t.options
          .filter((o) => t.collab!.optionMeta[o.id]!.by === 'council')
          .map((o) => o.label)
          .join(
            ' and ',
          )} as alternatives. Agents are checking free days and budgets; nobody's calendar or limits are shared.`,
      );
      runConstraints(tripId);
      return { ok: true, trip: view(deps.trips.get(tripId)!, v)! };
    },

    addOption(v, id, body) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (expireIfDue(t)) {
        deps.trips.put(t);
        return fail(409, 'expired', 'This trip expired.');
      }
      if (!['planning', 'voting'].includes(t.status))
        return fail(409, 'locked', 'Options are locked once voting has closed.');
      if (t.options.length >= 8) return fail(409, 'too_many', 'A trip can have at most 8 options.');
      if (dup(t, body.label)) return fail(409, 'duplicate', `${body.label} is already an option.`);
      const rev = bump(t);
      const id2 = optionId(t, body.label);
      const days = Math.min(body.days ?? 3, 14);
      const p = body.perPerson ?? 0;
      t.options.push({ id: id2, label: body.label, estCost: money(p), days, perPerson: p });
      t.collab!.optionMeta[id2] = { by: v.studentId, rev, days, perPerson: p };
      log(t, v.studentId, `${nameOf(v.studentId)} proposed ${body.label}`, id2);
      setReco(t);
      save(t);
      mirror(t, `${nameOf(v.studentId)} proposed ${body.label} (${days} days, ${money(p)} each).`);
      // A second live option is what makes a ballot possible: members without a card get one now.
      if (t.status === 'voting') promptVotes(t);
      rerun(t);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    editOption(v, id, optId, body) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (!['planning', 'voting'].includes(t.status))
        return fail(409, 'locked', 'Options are locked once voting has closed.');
      const o = t.options.find((x) => x.id === optId);
      const meta = t.collab!.optionMeta[optId];
      if (!o || !meta) return fail(404, 'not_found', 'That option no longer exists.');
      if (body.baseRev < meta.rev && !body.replace)
        return conflict(t, optId, 'Someone changed this option while you were editing.');
      if (body.label && dup(t, body.label, optId))
        return fail(409, 'duplicate', `${body.label} is already an option.`);
      const before = `${o.label}, ${meta.days}d, ${money(meta.perPerson)}`;
      if (body.label) o.label = body.label;
      if (body.days !== undefined) meta.days = body.days;
      if (body.perPerson !== undefined) meta.perPerson = body.perPerson;
      o.days = meta.days;
      o.perPerson = meta.perPerson;
      o.estCost = money(meta.perPerson);
      meta.rev = bump(t);
      const replaced = body.replace && body.baseRev < meta.rev - 1;
      log(
        t,
        v.studentId,
        `${nameOf(v.studentId)} changed ${before} to ${o.label}, ${meta.days}d, ${money(meta.perPerson)}${replaced ? ' (replaced a newer change)' : ''}`,
        optId,
      );
      setReco(t);
      save(t);
      mirror(t, t.collab!.changes.at(-1)!.summary + '.');
      rerun(t);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    removeOption(v, id, optId, baseRev, replace) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (!['planning', 'voting'].includes(t.status))
        return fail(409, 'locked', 'Options are locked once voting has closed.');
      const o = t.options.find((x) => x.id === optId);
      const meta = t.collab!.optionMeta[optId];
      if (!o || !meta) return fail(404, 'not_found', 'That option no longer exists.');
      if (meta.by !== v.studentId && t.collab!.organizer !== v.studentId)
        return fail(
          403,
          'forbidden',
          'Only who proposed an option, or the organizer, can remove it.',
        );
      if (baseRev !== undefined && baseRev < meta.rev && !replace)
        return conflict(
          t,
          optId,
          'Someone changed this option while you were deciding to remove it.',
        );
      if (t.options.length <= 1)
        return fail(409, 'last_option', 'A trip needs at least one option.');
      t.options = t.options.filter((x) => x.id !== optId);
      delete t.collab!.optionMeta[optId];
      t.vetoed = t.vetoed.filter((x) => x.optionId !== optId);
      t.votes = t.votes
        .map((x) => ({ ...x, ranking: x.ranking.filter((q) => q !== optId) }))
        .filter((x) => x.ranking.length > 0);
      bump(t);
      log(t, v.studentId, `${nameOf(v.studentId)} removed ${o.label}`, optId);
      setReco(t);
      save(t);
      mirror(t, `${nameOf(v.studentId)} removed ${o.label}.`);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    vote(v, id, body) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (expireIfDue(t)) {
        deps.trips.put(t);
        return fail(409, 'expired', 'This trip expired.');
      }
      if (t.status !== 'voting')
        return fail(
          409,
          'not_voting',
          t.status === 'planning'
            ? 'Voting opens once agents have checked free days and budgets.'
            : 'Voting is closed.',
        );
      if (!t.confirmations.some((x) => x.student === v.studentId))
        return fail(403, 'forbidden', 'You are not part of this trip.');
      const c = t.collab!;
      const ids = new Set(t.options.map((o) => o.id));
      if (body.baseRev !== undefined && body.baseRev < c.rev) {
        const touched = c.changes.filter(
          (x) =>
            x.rev > body.baseRev! &&
            x.optionId &&
            (body.ranking.includes(x.optionId) || !ids.has(x.optionId)),
        );
        if (touched.length)
          return conflict(
            t,
            touched.at(-1)!.optionId,
            'An option you ranked changed while you were voting.',
          );
      }
      if (body.ranking.some((x) => !ids.has(x)))
        return fail(400, 'invalid_request', 'unknown option');
      if (body.ranking.some((x) => t.vetoed.some((q) => q.optionId === x)))
        return fail(400, 'invalid_request', 'option was dropped by the group limits');
      const seen = [...new Set(body.ranking)];
      const rest = live(t)
        .map((o) => o.id)
        .filter((x) => !seen.includes(x));
      applyVote(t, v.studentId, [...seen, ...rest]);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    confirm(v, id, body) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (expireIfDue(t)) {
        deps.trips.put(t);
        return fail(409, 'expired', 'This trip expired.');
      }
      if (t.status === 'confirmed') return { ok: true, trip: view(t, v)! };
      if (t.status !== 'confirming')
        return fail(409, 'not_confirming', 'Confirmation opens when voting closes.');
      const c = t.collab!;
      if (!t.confirmations.some((x) => x.student === v.studentId))
        return fail(403, 'forbidden', 'You are not part of this trip.');
      const optId = body.optionId ?? c.chosen!.optionId;
      if (optId !== c.chosen!.optionId)
        return conflict(t, optId, 'The option up for confirmation changed.');
      if (
        body.baseRev !== undefined &&
        body.baseRev < c.rev &&
        c.changes.some((x) => x.rev > body.baseRev! && x.optionId === optId)
      )
        return conflict(t, optId, 'This option changed after you opened it.');
      if (t.confirmations.find((x) => x.student === v.studentId)?.confirmed && body.yes)
        return { ok: true, trip: view(t, v)! };
      applyConfirm(t, v.studentId, optId, body.yes);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    closeVoting(v, id) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (t.collab!.organizer !== v.studentId)
        return fail(403, 'forbidden', 'Only the organizer can close voting.');
      if (t.status !== 'voting') return fail(409, 'not_voting', 'Voting is not open.');
      if (t.votes.length === 0) return fail(409, 'no_votes', 'Nobody has voted yet.');
      closeNow(t, `${nameOf(v.studentId)} closed voting.`);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    async retry(v, id) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (!['planning', 'voting'].includes(t.status))
        return fail(409, 'not_open', 'This trip is no longer collecting constraints.');
      const last = lastRetry.get(t.tripId) ?? 0;
      if (now() - last < 2000) return fail(409, 'too_soon', 'Retry just ran. Give it a moment.');
      lastRetry.set(t.tripId, now());
      runConstraints(t.tripId);
      await svc.idle();
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    continueWithout(v, id) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      const c = t.collab!;
      if (c.organizer !== v.studentId)
        return fail(403, 'forbidden', 'Only the organizer can continue without an agent.');
      if (!['planning', 'voting'].includes(t.status))
        return fail(409, 'not_open', 'This trip is no longer collecting constraints.');
      if (!['waiting', 'failed'].includes(c.constraints.state))
        return fail(409, 'not_waiting', 'Nothing is waiting.');
      const names = c.constraints.waitingFor.map((w) => nameOf(w.id));
      c.constraints = {
        state: 'skipped',
        waitingFor: c.constraints.waitingFor,
        overlapDays: null,
        note: `Calendars and budgets were not checked${names.length ? ` for ${names.join(', ')}` : ''}.`,
        checkedAt: now(),
      };
      bump(t);
      log(t, v.studentId, `${nameOf(v.studentId)} continued without checking constraints`);
      openVoting(t, c.constraints.note!);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    reopen(v, id) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      const c = t.collab!;
      if (c.organizer !== v.studentId)
        return fail(403, 'forbidden', 'Only the organizer can reopen a trip.');
      if (!['failed', 'expired'].includes(t.status))
        return fail(409, 'not_reopenable', 'Only failed or expired trips can be reopened.');
      t.status = 'voting';
      dropCards(t, 'vote');
      dropCards(t, 'confirm');
      t.votes = [];
      t.confirmations = t.confirmations.map((x) => ({ student: x.student, confirmed: false }));
      c.chosen = null;
      c.failure = null;
      c.declined = [];
      t.dates = null;
      c.deadline = now() + DEFAULT_DEADLINE_MS;
      bump(t);
      log(t, v.studentId, `${nameOf(v.studentId)} reopened voting`);
      syncMembers(t);
      setReco(t);
      save(t);
      mirror(t, `${nameOf(v.studentId)} reopened voting. Earlier votes were cleared, vote again.`);
      promptVotes(t);
      return { ok: true, trip: view(deps.trips.get(t.tripId)!, v)! };
    },

    cancel(v, id) {
      const r = load(v, id);
      if ('ok' in r) return r;
      const t = r.t;
      if (t.collab!.organizer !== v.studentId)
        return fail(403, 'forbidden', 'Only the organizer can cancel the trip.');
      if (!ACTIVE.includes(t.status)) return fail(409, 'not_active', 'This trip is not active.');
      t.status = 'cancelled';
      dropCards(t, 'vote');
      dropCards(t, 'confirm');
      t.collab!.failure = {
        code: 'cancelled',
        message: `${nameOf(v.studentId)} cancelled the trip.`,
      };
      save(t);
      mirror(t, `${nameOf(v.studentId)} cancelled the trip.`);
      return { ok: true, trip: view(t, v)! };
    },

    async sweep() {
      for (const t of deps.trips.list()) {
        if (!t.collab) continue;
        if (expireIfDue(t)) {
          save(t);
          mirror(t, 'The deadline passed. The organizer can reopen voting.');
          continue;
        }
        if (
          ['planning', 'voting'].includes(t.status) &&
          ['waiting'].includes(t.collab.constraints.state)
        ) {
          const off = await refreshAgents(t);
          const cur = deps.trips.get(t.tripId);
          if (!cur?.collab) continue;
          cur.collab.agents = t.collab.agents;
          if (off.length === 0) {
            mirror(cur, 'All agents are back online. Checking free days and budgets now.');
            runConstraints(cur.tripId);
          } else save(cur);
        }
      }
    },

    async idle() {
      let prev: unknown;
      do {
        prev = [...chains.values()];
        await Promise.all([...chains.values()]);
      } while ([...chains.values()].some((p, i) => p !== (prev as Promise<void>[])[i]));
    },

    async handleChat(v, chatId, text) {
      return handleTripChat({ deps, svc, nameOf }, v, chatId, text);
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
  return svc;
}
