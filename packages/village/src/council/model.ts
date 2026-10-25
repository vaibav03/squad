import { a2aPartyName } from '../adapter/labels';
import { worstMode } from './mode';
import type { A2aCitation, A2aKind, A2aMessage, A2aStage, A2aStatus } from './types';

/** The seven steps a student sees. 'done' is not a step: it marks all of them complete. */
export const STEPS: readonly { stage: A2aStage; label: string }[] = [
  { stage: 'question', label: 'Question' },
  { stage: 'delegation', label: 'Delegation' },
  { stage: 'opinions', label: 'Opinions' },
  { stage: 'critiques', label: 'Critiques and ranks' },
  { stage: 'dissent', label: 'Dissent' },
  { stage: 'verdict', label: 'Verdict' },
  { stage: 'actions', label: 'Action items' },
];
export const stageIndex = (s: A2aStage): number =>
  s === 'done' ? STEPS.length : STEPS.findIndex((x) => x.stage === s);

/** Plain words for each message kind (a label next to the glyph, never colour alone). */
export const KIND_LABEL: Record<A2aKind, string> = {
  delegate: 'Delegates',
  ask: 'Asks',
  answer: 'Answers',
  critique: 'Critique',
  rank: 'Ranks',
  vote: 'Vote',
  verdict: 'Verdict',
  status: 'Status',
};
export const KINDS = Object.keys(KIND_LABEL) as A2aKind[];

export type BoardRole = 'chair' | 'specialist' | 'code';
export interface BoardAgent {
  id: string;
  /** Display name from the single label resolver. Never a raw id. */
  name: string;
  role: BoardRole;
  parent?: string;
  /** Cast art key when one exists (chill | grind | advisor | chair). */
  cast?: string;
  mode: string;
  status: A2aStatus;
  /** Latest PUBLIC summary of what the agent is doing or concluded. Never thinking. */
  summary?: string;
  stance?: string;
  answer?: string;
  order?: string[];
  /** When this agent last sent or got a message (arrival order). */
  lastSeq: number;
}

export interface BoardDelegation {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  summary: string;
  status: 'pending' | 'answered' | 'failed';
  answerId?: string;
  mode: string;
}

export interface BoardDissent {
  /** Display name of the dissenter. */
  who: string;
  whoId?: string;
  why: string;
  /** The dissenting message the verdict links to, when known. */
  messageId?: string;
}

export interface BoardVerdict {
  messageId?: string;
  summary: string;
  answer?: string;
  confidence?: string;
  mode: string;
  citations: A2aCitation[];
  dissents: BoardDissent[];
  actions: string[];
  /** Same items with the id of the envelope that carries each (hub action endpoints take that id). Legacy items have none. */
  actionItems: { id?: string; text: string }[];
}

export interface BoardRun {
  runId: string;
  councilId: string;
  councilName: string;
  question?: string;
  stage: A2aStage;
  /** Overall honesty of the run: worst agent mode. */
  mode: string;
  agents: BoardAgent[];
  messages: A2aMessage[];
  delegations: BoardDelegation[];
  verdict?: BoardVerdict;
  startedSeq: number;
}

export interface MutableRun extends BoardRun {
  /** Messages by id for parent/dissent lookups. */
  byId: Map<string, A2aMessage>;
  stageMode?: string;
}

const CAST: Record<string, string> = {
  chill: 'chill',
  grind: 'grind',
  advisor: 'advisor',
  chair: 'chair',
  chairman: 'chair',
};

/** 'council:ask-skeptic' -> 'council:ask'; 'council:ask' -> itself. Other ids keep their own run. */
export function councilOf(agent: string): string {
  const m = /^(council:[a-z]+)-.+$/i.exec(agent);
  return m ? m[1]! : agent;
}
const roleRef = (id: string): string => id.replace(/^council:[a-z]+-/i, '').toLowerCase();
export function roleOf(id: string): BoardRole {
  if (/^code:|^tool:/.test(id)) return 'code';
  return /^(chair|chairman)$/.test(roleRef(id)) ? 'chair' : 'specialist';
}
const castOf = (id: string): string | undefined => CAST[roleRef(id)];
const isAgent = (id: string): boolean =>
  id !== 'room' &&
  !id.startsWith('tool:') &&
  /^(council|student|expert|code):|^(dean|mediator)$/.test(id);

export function newRun(msg: { correlationId: string; from: string; seq: number }): MutableRun {
  const councilId = councilOf(msg.from);
  return {
    runId: msg.correlationId,
    councilId,
    councilName: a2aPartyName(councilId),
    stage: 'question',
    mode: 'demo',
    agents: [],
    messages: [],
    delegations: [],
    startedSeq: msg.seq,
    byId: new Map(),
  };
}

function ensureAgent(
  run: MutableRun,
  id: string,
  seq: number,
  mode: string,
): BoardAgent | undefined {
  if (!isAgent(id) && !id.startsWith('code:')) return undefined;
  let a = run.agents.find((x) => x.id === id);
  if (!a) {
    const cast = castOf(id);
    a = {
      id,
      name: a2aPartyName(id),
      role: roleOf(id),
      ...(cast ? { cast } : {}),
      // an agent that has only been spoken to carries the mode of what reached it, never an invented Demo
      mode,
      status: 'queued',
      lastSeq: seq,
    };
    run.agents.push(a);
    // chair first, then specialists in order of arrival, code agents last
    run.agents.sort((x, y) => ORDER[x.role] - ORDER[y.role]);
  }
  return a;
}
const ORDER: Record<BoardRole, number> = { chair: 0, specialist: 1, code: 2 };

/** Fold one message into the run (mutates `run`). Idempotent per message id and tolerant of out-of-order arrival. */
export function foldMessage(run: MutableRun, msg: A2aMessage): void {
  if (run.byId.has(msg.id)) {
    // an update of an existing message (status change, partial -> final): replace in place
    const i = run.messages.findIndex((m) => m.id === msg.id);
    if (i >= 0) run.messages[i] = msg;
  } else run.messages.push(msg);
  run.byId.set(msg.id, msg);
  run.messages.sort((a, b) => a.seq - b.seq);
  if (stageIndex(msg.stage) > stageIndex(run.stage)) run.stage = msg.stage;

  const from = ensureAgent(run, msg.from, msg.seq, msg.mode);
  const to = ensureAgent(run, msg.to, msg.seq, msg.mode);
  if (from) {
    from.mode = msg.mode;
    from.lastSeq = Math.max(from.lastSeq, msg.seq);
    // what a sender says while handing out or asking a question is not its own status; keep the last real statement
    if (msg.summary && msg.kind !== 'delegate' && msg.kind !== 'ask') from.summary = msg.summary;
    if (msg.stance) from.stance = msg.stance;
    if (msg.answer) from.answer = msg.answer;
    if (msg.order) from.order = msg.order;
    if (msg.kind !== 'delegate' && msg.kind !== 'ask') from.status = msg.status;
    else if (from.status === 'queued') from.status = 'working';
  }
  if (to) {
    to.lastSeq = Math.max(to.lastSeq, msg.seq);
    if ((msg.kind === 'delegate' || msg.kind === 'ask') && to.status === 'queued')
      to.status = 'working';
    if (msg.kind === 'delegate' && from && to.role !== 'chair' && !to.parent) to.parent = from.id;
  }
  if (msg.kind === 'delegate' && !run.delegations.some((d) => d.id === msg.id)) {
    run.delegations.push({
      id: msg.id,
      from: msg.from,
      fromName: a2aPartyName(msg.from),
      to: msg.to,
      toName: a2aPartyName(msg.to),
      summary: msg.summary ?? 'Asked to weigh in.',
      status: msg.status === 'failed' || msg.status === 'skipped' ? 'failed' : 'pending',
      mode: msg.mode,
    });
  } else if (msg.kind === 'delegate') {
    const d = run.delegations.find((x) => x.id === msg.id)!;
    if (msg.status === 'failed' || msg.status === 'skipped') d.status = 'failed';
  }
  // an answer from a delegate resolves the delegation addressed to it (by parent link, else the latest pending)
  if (msg.kind === 'answer' || (msg.kind === 'status' && msg.status === 'failed')) {
    const d =
      run.delegations.find((x) => x.id === msg.parentMessageId) ??
      [...run.delegations].reverse().find((x) => x.to === msg.from && x.status === 'pending');
    if (d && d.status === 'pending' && msg.from === d.to)
      Object.assign(d, {
        status: msg.status === 'failed' ? 'failed' : 'answered',
        answerId: msg.id,
      });
  }
  // chair is the parent of every specialist of its council even without a delegate message (legacy runs)
  const chair = run.agents.find((a) => a.role === 'chair');
  if (chair) for (const a of run.agents) if (a.role !== 'chair' && !a.parent) a.parent = chair.id;

  if (msg.kind === 'verdict') run.verdict = buildVerdict(run, msg);
  else if (run.verdict && msg.stage === 'actions')
    run.verdict = buildVerdict(run, run.byId.get(run.verdict.messageId ?? '') ?? msg);
  run.mode = worstMode(run.agents.map((a) => a.mode));
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function buildVerdict(run: MutableRun, msg: A2aMessage): BoardVerdict {
  const dissents: BoardDissent[] = [];
  for (const ref of msg.dissentRefs ?? []) {
    const m = run.byId.get(ref);
    if (m)
      dissents.push({
        who: a2aPartyName(m.from),
        whoId: m.from,
        why: m.summary ?? m.stance ?? m.answer ?? 'Disagreed with the verdict.',
        messageId: m.id,
      });
  }
  const actionMsgs = run.messages.filter((m) => m.stage === 'actions' && m.summary);
  const actions = actionMsgs.length
    ? actionMsgs.map((m) => m.summary!)
    : (msg as A2aMessage & { next?: string }).next
      ? sentences((msg as A2aMessage & { next?: string }).next!)
      : [];
  const actionItems = actionMsgs.length
    ? actionMsgs.map((m) => ({ id: m.id, text: m.summary! }))
    : actions.map((text) => ({ text }));
  return {
    messageId: msg.id,
    summary: msg.summary ?? msg.answer ?? 'The chair has decided.',
    ...(msg.answer ? { answer: msg.answer } : {}),
    ...(msg.confidence ? { confidence: msg.confidence } : {}),
    mode: msg.mode,
    citations: msg.citations ?? [],
    dissents,
    actions,
    actionItems,
  };
}

/** Parent chain of a message, oldest first, ending with the message (for "highlight this path"). */
export function threadPath(run: BoardRun, id: string): string[] {
  const byId = new Map(run.messages.map((m) => [m.id, m]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (
    let cur = byId.get(id);
    cur && !seen.has(cur.id);
    cur = cur.parentMessageId ? byId.get(cur.parentMessageId) : undefined
  ) {
    seen.add(cur.id);
    out.unshift(cur.id);
  }
  return out;
}

/** Depth of a message in the delegation tree (0 = root), for feed indentation. Capped at 3. */
export function depthOf(run: BoardRun, id: string): number {
  return Math.min(3, Math.max(0, threadPath(run, id).length - 1));
}

/** Plain sentence for a message row: 'Skeptic to Chair: Critique'. Used by the feed and announcements. */
export function messageHeadline(m: A2aMessage): string {
  return `${a2aPartyName(m.from)} to ${a2aPartyName(m.to)}: ${KIND_LABEL[m.kind]}`;
}

const STAGE_STATUS: Record<A2aStage, string> = {
  question: 'Question received. Getting the council together.',
  delegation: 'The chair is deciding who to ask.',
  opinions: 'Members are answering.',
  critiques: 'Members are ranking each other\u2019s answers.',
  dissent: 'Checking where members disagree.',
  verdict: 'The chair is writing the verdict.',
  actions: 'Turning the verdict into action items.',
  done: 'Done.',
};

/**
 * One public sentence for the board header: the CURRENT state of the run. Once there is a verdict it is the verdict
 * itself (never the opening "Question received" line), otherwise the step the run is in, with who is still working.
 */
export function statusLine(run: Pick<BoardRun, 'stage' | 'verdict' | 'agents'>): string {
  const v = run.verdict;
  if (v && stageIndex(run.stage) >= stageIndex('verdict'))
    return (v.answer ?? v.summary).trim() || STAGE_STATUS[run.stage];
  const base = STAGE_STATUS[run.stage];
  if (run.stage === 'opinions') {
    const waiting = run.agents.filter((a) => a.role === 'specialist' && a.status === 'working');
    if (waiting.length) return `Waiting for ${waiting.map((a) => a.name).join(', ')}.`;
  }
  return base;
}
