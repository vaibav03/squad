import type { VillageSource } from '@squad/core';
import { a2aPartyName } from '../adapter/labels';
import {
  foldMessage,
  newRun,
  stageIndex,
  type BoardAgent,
  type BoardDelegation,
  type BoardRun,
  type MutableRun,
} from './model';
import type { A2aKind, A2aMessage, A2aStage } from './types';

export interface CouncilBoardOptions {
  now?: () => number;
  /** Mode for legacy `council.*` events that say nothing about demo (replays pass 'demo'). Default 'demo': honest. */
  defaultMode?: string;
}

export interface BoardLink {
  messageId: string;
  runId: string;
  from: string;
  to: string;
  kind: A2aKind;
  /** Arrival time (ms, store clock). */
  at: number;
}

export interface Hierarchy {
  run: BoardRun;
  agent: BoardAgent;
  parent?: BoardAgent;
  children: BoardAgent[];
  delegationsIn: BoardDelegation[];
  delegationsOut: BoardDelegation[];
  /** Position in words: 'Chair', 'Specialist under Chair'. */
  position: string;
}

export interface CouncilBoardStore {
  apply(event: unknown): void;
  attach(source: VillageSource): () => void;
  /** Runs, oldest first. */
  runs(): BoardRun[];
  /** The selected run, else the one with the most recent activity. */
  run(): BoardRun | undefined;
  selectRun(runId: string | null): void;
  /** Run whose roster contains this agent (latest first). */
  runOf(agent: string): BoardRun | undefined;
  hierarchy(agent: string): Hierarchy | undefined;
  /** Messages that arrived in the last `windowMs` between two agents (arrows). Newest last. */
  links(windowMs?: number): BoardLink[];
  /** Agent ids that appear in any council run (to know whom the Hierarchy tab applies to). */
  has(agent: string): boolean;
  reset(): void;
  subscribe(fn: () => void): () => void;
  readonly version: number;
}

const LINK_WINDOW_MS = 4000;

const asRec = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Minimal guard: only the fields the board reads; unknown extra keys are ignored, thinking fields are never read. */
export function asA2aMessage(v: unknown): A2aMessage | undefined {
  const m = asRec(v);
  if (!m) return undefined;
  const id = str(m.id);
  const from = str(m.from);
  const to = str(m.to);
  const kind = str(m.kind);
  const stage = str(m.stage);
  const correlationId = str(m.correlationId);
  if (!id || !from || !to || !kind || !stage || !correlationId) return undefined;
  if (typeof m.seq !== 'number') return undefined;
  const pick = <K extends keyof A2aMessage>(k: K): Pick<A2aMessage, K> | object =>
    m[k] === undefined ? {} : { [k]: m[k] };
  return {
    id,
    correlationId,
    seq: m.seq,
    from,
    to,
    kind: kind as A2aKind,
    stage: stage as A2aStage,
    status: (str(m.status) ?? 'done') as A2aMessage['status'],
    mode: str(m.mode) ?? 'demo',
    source: (str(m.source) ?? 'script') as A2aMessage['source'],
    redaction: m.redaction === 'asker_only' ? 'asker_only' : 'public',
    ts: typeof m.ts === 'number' ? m.ts : 0,
    ...pick('parentMessageId'),
    ...pick('summary'),
    ...pick('stance'),
    ...pick('answer'),
    ...pick('order'),
    ...pick('confidence'),
    ...pick('dissentRefs'),
    ...pick('citations'),
    ...pick('partial'),
  } as A2aMessage;
}

/**
 * Folds `a2a.message` and `council.stage` events into per-run board state. Legacy `council.opinion|rank|verdict`
 * events (today's replays and the current hub) are mapped to messages too, but only for councils that never sent
 * a2a events, so a hub that emits both does not double up. Reads only public fields.
 */
export function createCouncilBoardStore(opts: CouncilBoardOptions = {}): CouncilBoardStore {
  const now = opts.now ?? (() => Date.now());
  const defaultMode = opts.defaultMode ?? 'demo';
  const runs = new Map<string, MutableRun>();
  const arrived = new Map<string, number>();
  const linkLog: BoardLink[] = [];
  const subs = new Set<() => void>();
  const a2aCouncils = new Set<string>();
  const legacy = new Map<string, { runId: string; seq: number; n: number; closed: boolean }>();
  let selected: string | null = null;
  let version = 0;
  let touch = 0;
  const touched = new Map<string, number>();

  const bump = () => {
    version++;
    for (const f of [...subs]) f();
  };

  const runFor = (corr: string, from: string): MutableRun => {
    let r = runs.get(corr);
    if (!r) {
      r = newRun({ correlationId: corr, from, seq: 0 });
      runs.set(corr, r);
    }
    touched.set(corr, ++touch);
    return r;
  };

  const addMessage = (msg: A2aMessage): void => {
    const run = runFor(msg.correlationId, msg.from);
    const first = !run.byId.has(msg.id);
    foldMessage(run, msg);
    if (first) {
      arrived.set(msg.id, now());
      if (!msg.to.startsWith('tool:') && msg.to !== 'room' && msg.to !== msg.from)
        linkLog.push({
          messageId: msg.id,
          runId: msg.correlationId,
          from: msg.from,
          to: msg.to,
          kind: msg.kind,
          at: now(),
        });
      if (linkLog.length > 60) linkLog.splice(0, linkLog.length - 60);
    }
    // a question only ever comes from the stage event or the run result; the opening status line
    // ("Question received...", "Council convened.") is progress text, not the question.
  };

  const legacyMessage = (ev: Record<string, unknown>): void => {
    const councilId = str(ev.councilId);
    const member = str(ev.member);
    const t = str(ev.t);
    if (!councilId || !member || !t || a2aCouncils.has(councilId) || str(ev.a2aId)) return;
    let st = legacy.get(councilId);
    if (!st || (st.closed && t === 'council.opinion')) {
      st = {
        runId: `legacy:${councilId}:${(st?.n ?? 0) + 1}`,
        seq: 0,
        n: (st?.n ?? 0) + 1,
        closed: false,
      };
      legacy.set(councilId, st);
    }
    const work = asRec(ev.work);
    const mode = work?.demo === true ? 'demo' : work?.demo === false ? 'live' : defaultMode;
    const chair = `${councilId}-chair`;
    const who = member === 'chair' || member === 'chairman' ? chair : `${councilId}-${member}`;
    const text = str(ev.text) ?? str(ev.message);
    const base = {
      correlationId: st.runId,
      status: 'done' as const,
      mode,
      source: (mode === 'live' ? 'model' : 'script') as 'model' | 'script',
      redaction: 'public' as const,
      ts: now(),
    };
    const id = () => `am_leg${String(++st!.seq).padStart(8, '0')}`;
    if (t === 'council.opinion') {
      addMessage({
        ...base,
        id: id(),
        seq: st.seq,
        from: who,
        to: chair,
        kind: 'answer',
        stage: 'opinions',
        ...(text ? { summary: text.slice(0, 280) } : {}),
      });
    } else if (t === 'council.rank') {
      const order = Array.isArray(ev.order)
        ? ev.order.filter((x): x is string => typeof x === 'string')
        : [];
      addMessage({
        ...base,
        id: id(),
        seq: st.seq,
        from: who,
        to: chair,
        kind: 'rank',
        stage: 'critiques',
        ...(order.length ? { order: order.map((o) => a2aPartyName(`${councilId}-${o}`)) } : {}),
        summary: text ?? 'Ranked the other answers without names.',
      });
    } else if (t === 'council.verdict') {
      const ids = [...(runs.get(st.runId)?.messages ?? [])].filter((m) => m.kind === 'answer');
      const dissenter = str(ev.dissenter);
      const ref = dissenter ? ids.find((m) => m.from === `${councilId}-${dissenter}`) : undefined;
      addMessage({
        ...base,
        id: id(),
        seq: st.seq,
        from: chair,
        to: 'room',
        kind: 'verdict',
        stage: 'verdict',
        summary: text ?? 'The chair has decided.',
        ...(ref ? { dissentRefs: [ref.id] } : {}),
      });
      st.closed = true;
    }
  };

  const apply = (event: unknown): void => {
    const ev = asRec(event);
    if (!ev) return;
    const t = str(ev.t);
    if (t === 'a2a.message') {
      const msg = asA2aMessage(ev.msg);
      if (!msg) return;
      a2aCouncils.add(roleCouncil(msg.from));
      addMessage(msg);
      bump();
    } else if (t === 'council.stage') {
      const corr = str(ev.correlationId);
      const councilId = str(ev.councilId);
      const stage = str(ev.stage) as A2aStage | undefined;
      if (!corr || !councilId || !stage) return;
      a2aCouncils.add(councilId);
      const run = runFor(corr, councilId);
      // a stale snapshot (poll or closed stream) must never move a run back: stages only go forward
      if (run.stage && stageIndex(stage) < stageIndex(run.stage as A2aStage)) {
        const q0 = str(ev.question);
        if (q0 && !run.question) run.question = q0;
        return;
      }
      run.stage = stage;
      run.stageMode = str(ev.mode);
      const q = str(ev.question);
      if (q) run.question = q;
      bump();
    } else if (t === 'council.opinion' || t === 'council.rank' || t === 'council.verdict') {
      legacyMessage(ev);
      bump();
    }
  };

  const roleCouncil = (agent: string): string => {
    const m = /^(council:[a-z]+)-.+$/i.exec(agent);
    return m ? m[1]! : agent;
  };

  const list = (): BoardRun[] => [...runs.values()];
  const current = (): BoardRun | undefined => {
    if (selected && runs.has(selected)) return runs.get(selected);
    let best: MutableRun | undefined;
    for (const r of runs.values())
      if (!best || (touched.get(r.runId) ?? 0) >= (touched.get(best.runId) ?? 0)) best = r;
    return best;
  };
  const runOf = (agent: string): BoardRun | undefined =>
    [...runs.values()]
      .sort((a, b) => (touched.get(b.runId) ?? 0) - (touched.get(a.runId) ?? 0))
      .find((r) => r.agents.some((a) => a.id === agent));

  return {
    apply,
    attach(source) {
      const off = source.subscribe((e: unknown) => apply(e));
      return typeof off === 'function' ? off : () => {};
    },
    runs: list,
    run: current,
    selectRun(id) {
      selected = id;
      bump();
    },
    runOf,
    hierarchy(agent) {
      const run = runOf(agent);
      const a = run?.agents.find((x) => x.id === agent);
      if (!run || !a) return undefined;
      const parent = a.parent ? run.agents.find((x) => x.id === a.parent) : undefined;
      const pName = parent?.name;
      return {
        run,
        agent: a,
        ...(parent ? { parent } : {}),
        children: run.agents.filter((x) => x.parent === a.id),
        delegationsIn: run.delegations.filter((d) => d.to === a.id),
        delegationsOut: run.delegations.filter((d) => d.from === a.id),
        position:
          a.role === 'chair'
            ? 'Chair, top of the tree'
            : a.role === 'code'
              ? 'Checked in code, not a model'
              : pName
                ? `Specialist under ${pName}`
                : 'Specialist',
      };
    },
    links(windowMs = LINK_WINDOW_MS) {
      const t = now();
      return linkLog.filter((l) => t - l.at <= windowMs);
    },
    has: (agent) => [...runs.values()].some((r) => r.agents.some((a) => a.id === agent)),
    reset() {
      runs.clear();
      arrived.clear();
      linkLog.length = 0;
      a2aCouncils.clear();
      legacy.clear();
      selected = null;
      bump();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    get version() {
      return version;
    },
  };
}

export { stageIndex };
