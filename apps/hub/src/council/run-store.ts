// Persisted council runs per squad (docs/council-live-ux.md): the last 20 runs of each squad with their hierarchy, A2A
// envelopes, stage, mode, transport and action items, so the board, the inspector and the room panels still show the last
// council after it ended and after a reload or a restart. Fed by the ingestor (every `a2a.message` / `council.stage`
// event); read through the SAME per-viewer filter as the live stream, so a squadmate sees what the stream showed them and a
// private (DM) run shows only arrows and kinds to everyone but the asker.
import {
  A2aMessageSchema,
  councilRunMeta,
  councilRunOwner,
  type A2aMessage,
  type AgentMode,
  type CouncilAction,
  type CouncilAgentInfo,
  type CouncilResult,
  type CouncilRunRecord,
  type CouncilRunTransport,
  type Db,
  type StudentId,
  type VillageEvent,
  worstMode,
} from '@squad/core';
import { filterVillageEvent } from '../filter';
import type { FilterCtx, Viewer } from '../types';

export const KEEP_PER_SQUAD = 20;
const MAX_MESSAGES = 120;
/** A run with no event for this long and no `done` stage is shown as failed (the process that ran it is gone). */
const STALE_MS = 10 * 60_000;

interface Stored {
  id: string;
  squadId: string;
  councilKey: string;
  askedBy: string;
  private: boolean;
  question: string;
  transport: CouncilRunTransport;
  roster: { id: string; role: string; parent?: string; displayName: string }[];
  startedAt: number;
  updatedAt: number;
  stage: string;
  mode: AgentMode;
  finished: boolean;
  messages: A2aMessage[];
}

export interface CouncilRunStore {
  /** Feed every village event; only `a2a.message` and `council.stage` matter. Never throws. */
  observe(e: VillageEvent): void;
  /** Squad-level owner lookup that survives a restart (falls back for the A2A filter). */
  ownerOf(id: string): { askedBy: string; squadId: string; private: boolean } | undefined;
  /** Last runs of the viewer's squad, newest first, viewer-filtered. `result` resolves the ask council's result card. */
  list(
    viewer: Viewer,
    o?: {
      councilKey?: string;
      limit?: number;
      result?: (id: string) => CouncilResult | undefined;
    },
  ): CouncilRunRecord[];
  /** Counters for the status endpoint. */
  stats(): { runs: number; messages: number; delegations: number; active: number; lastStage?: string };
  clear(): void;
}

export function createCouncilRunStore(
  db: Db,
  ctx: () => FilterCtx,
  squadOf: (studentId: string) => string | undefined,
  now: () => number = Date.now,
): CouncilRunStore {
  db.exec(
    `CREATE TABLE IF NOT EXISTS hub_council_runs(
      id TEXT PRIMARY KEY, squad_id TEXT NOT NULL, council_key TEXT NOT NULL, updated_at INTEGER NOT NULL, json TEXT NOT NULL)`,
  );
  db.exec('CREATE INDEX IF NOT EXISTS hub_council_runs_squad ON hub_council_runs(squad_id, updated_at)');
  const runs = new Map<string, Stored>();
  const upsert = db.prepare(
    'INSERT INTO hub_council_runs(id, squad_id, council_key, updated_at, json) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, json=excluded.json',
  );
  const prune = db.prepare(
    'DELETE FROM hub_council_runs WHERE squad_id=? AND id NOT IN (SELECT id FROM hub_council_runs WHERE squad_id=? ORDER BY updated_at DESC LIMIT ?)',
  );
  const save = (r: Stored): void => {
    try {
      upsert.run(r.id, r.squadId, r.councilKey, r.updatedAt, JSON.stringify(r));
    } catch {
      // persistence is best effort
    }
  };

  const load = (id: string): Stored | undefined => {
    const hit = runs.get(id);
    if (hit) return hit;
    const row = db.prepare('SELECT json FROM hub_council_runs WHERE id=?').get(id) as
      | { json: string }
      | undefined;
    if (!row) return undefined;
    try {
      const r = JSON.parse(row.json) as Stored;
      runs.set(id, r);
      return r;
    } catch {
      return undefined;
    }
  };

  const keyOf = (councilId: string): string => councilId.replace(/^council:/, '').split('-')[0] ?? 'ask';

  const begin = (id: string, fallbackKey: string): Stored | undefined => {
    const existing = load(id);
    if (existing) return existing;
    const owner = councilRunOwner(id);
    if (!owner) return undefined;
    const squadId = squadOf(owner.askedBy as StudentId);
    if (!squadId) return undefined;
    const meta = councilRunMeta(id);
    const r: Stored = {
      id,
      squadId,
      councilKey: meta?.councilKey ?? fallbackKey,
      askedBy: owner.askedBy,
      private: owner.private,
      question: meta?.question ?? '',
      transport: meta?.transport ?? { kind: 'stream-text', label: 'Gemini streaming text' },
      roster: meta?.roster ?? [],
      startedAt: meta?.startedAt ?? now(),
      updatedAt: now(),
      stage: 'question',
      mode: 'live',
      finished: false,
      messages: [],
    };
    runs.set(id, r);
    return r;
  };

  const stripped = (m: A2aMessage): A2aMessage => m;

  return {
    observe(e) {
      try {
        if (e.t === 'a2a.message') {
          const id = e.msg.correlationId;
          if (!id.startsWith('cn_')) return;
          const r = begin(id, keyOf(e.msg.from));
          if (!r) return;
          if (!r.messages.some((m) => m.id === e.msg.id)) r.messages.push(stripped(e.msg));
          if (r.messages.length > MAX_MESSAGES) r.messages.shift();
          r.updatedAt = now();
          r.stage = e.msg.stage;
          r.mode = r.messages.length <= 1 ? e.msg.mode : worstMode([r.mode, e.msg.mode]);
          save(r);
          prune.run(r.squadId, r.squadId, KEEP_PER_SQUAD);
        } else if (e.t === 'council.stage') {
          const id = e.correlationId;
          if (!id.startsWith('cn_')) return;
          const r = begin(id, keyOf(e.councilId));
          if (!r) return;
          r.stage = e.stage;
          r.mode = e.mode;
          r.updatedAt = now();
          if (e.stage === 'done') r.finished = true;
          save(r);
          prune.run(r.squadId, r.squadId, KEEP_PER_SQUAD);
        }
      } catch {
        // observing must never break ingest
      }
    },

    ownerOf(id) {
      const r = load(id);
      return r ? { askedBy: r.askedBy, squadId: r.squadId, private: r.private } : undefined;
    },

    list(viewer, o = {}) {
      const rows = db
        .prepare(
          'SELECT id FROM hub_council_runs WHERE squad_id=? ORDER BY updated_at DESC LIMIT ?',
        )
        .all(viewer.squadId, KEEP_PER_SQUAD) as { id: string }[];
      const out: CouncilRunRecord[] = [];
      const limit = Math.max(1, Math.min(o.limit ?? KEEP_PER_SQUAD, KEEP_PER_SQUAD));
      for (const { id } of rows) {
        const r = load(id);
        if (!r || r.squadId !== viewer.squadId) continue;
        if (o.councilKey && r.councilKey !== o.councilKey) continue;
        const asker = r.askedBy === viewer.studentId;
        const hide = r.private && !asker;
        // viewer-filtered envelopes: the exact rules of the live stream
        const messages: A2aMessage[] = [];
        for (const m of r.messages) {
          const f = filterVillageEvent(
            { t: 'a2a.message', msg: m, mode: m.mode },
            viewer,
            ctx(),
          );
          if (f && f.t === 'a2a.message') {
            const p = A2aMessageSchema.safeParse(f.msg);
            if (p.success) messages.push(p.data);
          }
        }
        const result = r.councilKey === 'ask' ? o.result?.(r.id) : undefined;
        const resultOk = result && !hide ? result : undefined;
        const stale = !r.finished && now() - r.updatedAt > STALE_MS;
        const status: CouncilRunRecord['status'] = resultOk
          ? resultOk.status
          : r.finished
            ? 'done'
            : stale
              ? 'failed'
              : 'running';
        const actions: CouncilAction[] = hide
          ? []
          : (resultOk?.actions ??
            messages
              .filter((m) => m.stage === 'actions' && m.kind === 'status' && m.summary)
              .slice(0, 4)
              .map((m) => ({ id: m.id, title: m.summary! })));
        const agents: CouncilAgentInfo[] =
          resultOk?.agents ??
          r.roster.map((s) => {
            const mine = messages.filter((m) => m.from === s.id);
            const failed = mine.some((m) => m.status === 'failed' || m.status === 'skipped');
            const spoke = mine.some((m) => m.status === 'done' || m.status === 'partial');
            return {
              id: s.id,
              role: s.role,
              ...(s.parent ? { parent: s.parent } : {}),
              displayName: s.displayName,
              mode: mine.length ? worstMode(mine.map((m) => m.mode)) : r.mode,
              transport: r.transport.kind,
              status: failed && !spoke ? 'failed' : spoke ? 'done' : status === 'running' ? 'queued' : 'skipped',
            };
          });
        out.push({
          id: r.id as CouncilRunRecord['id'],
          councilKey: r.councilKey,
          question: hide ? '' : r.question,
          status,
          mode: (resultOk?.mode as AgentMode | undefined) ?? r.mode,
          transport: resultOk?.transport ?? r.transport,
          stage: r.stage,
          startedAt: r.startedAt,
          ...(r.finished || status !== 'running' ? { finishedAt: r.updatedAt } : {}),
          askedBy: r.askedBy,
          private: r.private,
          agents: agents.slice(0, 8),
          messages: messages.slice(-MAX_MESSAGES),
          actions,
          counters: {
            messages: messages.filter((m) => !m.to.startsWith('tool:')).length,
            delegations: messages.filter((m) => m.kind === 'delegate').length,
          },
          ...(resultOk ? { result: resultOk } : {}),
        });
        if (out.length >= limit) break;
      }
      return out;
    },

    stats() {
      const rows = db.prepare('SELECT json FROM hub_council_runs').all() as { json: string }[];
      let messages = 0;
      let delegations = 0;
      let active = 0;
      let last: { at: number; stage: string } | undefined;
      for (const row of rows) {
        try {
          const r = JSON.parse(row.json) as Stored;
          messages += r.messages.filter((m) => !m.to.startsWith('tool:')).length;
          delegations += r.messages.filter((m) => m.kind === 'delegate').length;
          if (!r.finished && now() - r.updatedAt <= STALE_MS) active++;
          if (!last || r.updatedAt > last.at) last = { at: r.updatedAt, stage: r.stage };
        } catch {
          /* skip a corrupt row */
        }
      }
      return {
        runs: rows.length,
        messages,
        delegations,
        active,
        ...(last ? { lastStage: last.stage } : {}),
      };
    },

    clear() {
      runs.clear();
      db.exec('DELETE FROM hub_council_runs');
    },
  };
}
