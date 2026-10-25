import { a2aPartyName } from '../adapter/labels';
import { KIND_LABEL, STEPS, compareEnvelopes } from './model';
import { modeInfo } from './mode';
import type { A2aCitation, A2aKind, A2aMessage, A2aStage } from './types';

/**
 * Handoff timeline and reasoning-summary view models. Pure and render-free so ordering, filtering, status and the
 * privacy guard are unit tested. Everything is built from the PUBLIC envelope fields only (`PUBLIC_TURN_FIELDS`);
 * there is no field anywhere for thinking text, hidden prompts or scratch reasoning.
 */

export type HandoffStatus = 'queued' | 'working' | 'done' | 'degraded';
export const HANDOFF_STATUS_LABEL: Record<HandoffStatus, string> = {
  queued: 'Queued',
  working: 'Working',
  done: 'Done',
  degraded: 'Degraded',
};

/** The only envelope fields a card or row may read. Anything else on an object is ignored by construction. */
export const PUBLIC_TURN_FIELDS = [
  'id',
  'seq',
  'ts',
  'from',
  'to',
  'kind',
  'stage',
  'parentMessageId',
  'summary',
  'stance',
  'answer',
  'order',
  'confidence',
  'dissentRefs',
  'citations',
  'status',
  'mode',
  'source',
  'partial',
  'redaction',
] as const;

export const STAGE_LABEL: Record<A2aStage, string> = {
  question: 'Question',
  delegation: 'Delegation',
  opinions: 'Opinions',
  critiques: 'Critiques and ranks',
  dissent: 'Dissent',
  verdict: 'Verdict',
  actions: 'Action items',
  done: 'Done',
};

/** Purpose words for the Purpose column and chips. */
export const PURPOSE_LABEL: Record<A2aKind, string> = {
  delegate: 'Delegate',
  ask: 'Ask',
  answer: 'Answer',
  critique: 'Critique',
  rank: 'Rank',
  vote: 'Vote',
  verdict: 'Verdict',
  status: 'Status',
};

export const sortEnvelopes = <T extends Pick<A2aMessage, 'seq' | 'ts' | 'id'>>(msgs: readonly T[]): T[] =>
  [...msgs].sort(compareEnvelopes);

export interface HandoffRow {
  /** Turn number in the whole run (stable across filters). */
  n: number;
  id: string;
  ts: number;
  stage: A2aStage;
  stageLabel: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** 'Skeptic → Chair' */
  label: string;
  kind: A2aKind;
  purpose: string;
  summary: string;
  /** Redacted (private run skeleton): the arrow and purpose still draw, the text does not. */
  hidden: boolean;
  status: HandoffStatus;
  statusNote?: string;
  mode: string;
  scripted: boolean;
  partial: boolean;
  citations: A2aCitation[];
}

const REPLY_KINDS: ReadonlySet<A2aKind> = new Set(['answer', 'critique', 'rank', 'vote', 'verdict']);

/** True when the id belongs to this agent. `match` lets callers resolve aliases (voice keys, room agents). */
export const involves = (m: Pick<A2aMessage, 'from' | 'to'>, agent: string | ((id: string) => boolean)): boolean => {
  const is = typeof agent === 'function' ? agent : (id: string) => id === agent;
  return is(m.from) || is(m.to);
};

function statusOf(
  sorted: readonly A2aMessage[],
  i: number,
  runDone: boolean,
): { status: HandoffStatus; note?: string } {
  const m = sorted[i]!;
  const tier = modeInfo(m.mode).tier;
  if (m.status === 'failed' || m.status === 'skipped')
    return { status: 'degraded', note: m.status === 'failed' ? 'Did not complete' : 'Skipped' };
  if (m.status === 'partial' || m.partial) return { status: 'degraded', note: 'Cut short' };
  if (tier === 'degraded') return { status: 'degraded', note: modeInfo(m.mode).word };
  if (m.status === 'queued') return { status: 'queued' };
  if (m.status === 'working') {
    const later = sorted.slice(i + 1).some((x) => x.from === m.from && x.parentMessageId === m.id);
    return { status: later || runDone ? 'done' : 'working' };
  }
  // done: a delegation or question is only finished once the recipient has replied (or the run closed)
  if (m.kind === 'delegate' || m.kind === 'ask') {
    const reply = sorted
      .slice(i + 1)
      .find(
        (x) =>
          x.from === m.to &&
          (x.parentMessageId === m.id || (REPLY_KINDS.has(x.kind) && x.to === m.from)),
      );
    if (reply) {
      if (reply.status === 'failed' || modeInfo(reply.mode).tier === 'degraded')
        return { status: 'degraded', note: 'The answer was degraded' };
      return { status: 'done' };
    }
    return runDone ? { status: 'done' } : { status: 'working', note: 'Waiting for the reply' };
  }
  return { status: 'done' };
}

export interface HandoffOptions {
  /** Only messages sent or received by this agent (id, or a predicate that resolves aliases). */
  agent?: string | ((id: string) => boolean) | undefined;
  /** The run reached its last stage: nothing is still pending. */
  runDone?: boolean | undefined;
}

/** Chronological rows (seq, then ts, then id). `n` always counts over the WHOLE run so filtering keeps the turn number. */
export function handoffRows(messages: readonly A2aMessage[], o: HandoffOptions = {}): HandoffRow[] {
  const sorted = sortEnvelopes(messages);
  const out: HandoffRow[] = [];
  sorted.forEach((m, i) => {
    if (o.agent && !involves(m, o.agent)) return;
    const { status, note } = statusOf(sorted, i, !!o.runDone);
    const fromName = a2aPartyName(m.from);
    const toName = a2aPartyName(m.to);
    const text = m.summary ?? m.answer ?? m.stance ?? '';
    out.push({
      n: i + 1,
      id: m.id,
      ts: m.ts,
      stage: m.stage,
      stageLabel: STAGE_LABEL[m.stage] ?? m.stage,
      from: m.from,
      fromName,
      to: m.to,
      toName,
      label: `${fromName} → ${toName}`,
      kind: m.kind,
      purpose: PURPOSE_LABEL[m.kind] ?? KIND_LABEL[m.kind],
      summary: text,
      hidden: !text && !m.order?.length,
      status,
      ...(note ? { statusNote: note } : {}),
      mode: m.mode,
      scripted: m.source === 'script' || modeInfo(m.mode).tier === 'demo',
      partial: !!m.partial,
      citations: m.citations ?? [],
    });
  });
  return out;
}

export interface HandoffGroup {
  stage: A2aStage;
  label: string;
  rows: HandoffRow[];
}

/** Group consecutive rows by stage (stage order of the run, never alphabetical). */
export function groupByStage(rows: readonly HandoffRow[]): HandoffGroup[] {
  const groups: HandoffGroup[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.stage === r.stage) g.rows.push(r);
    else groups.push({ stage: r.stage, label: r.stageLabel, rows: [r] });
  }
  return groups;
}
export const STAGE_ORDER: readonly A2aStage[] = [...STEPS.map((s) => s.stage), 'done'];

/* ---------------- reasoning summary cards ---------------- */

/** Fields of a public turn card. Nothing here can carry thinking text. */
export interface ReasoningCard {
  id: string;
  ts: number;
  stage: A2aStage;
  kind: A2aKind;
  /** Where this turn came from: the delegate or ask that triggered it, else the run question. */
  goal: string;
  evidence: A2aCitation[];
  /** The agent's public stance and answer. */
  decision: { stance?: string; text: string };
  next: string;
  scripted: boolean;
  mode: string;
}

export const REASONING_FOOTER = 'Summary shared by the agent. Private reasoning is never shown.';

const DECISION_KINDS: ReadonlySet<A2aKind> = new Set(['answer', 'critique', 'rank', 'vote', 'verdict']);

/** Reduce an envelope to its public fields only (runtime guard on top of the schema: unknown keys are dropped). */
export function publicTurn(m: A2aMessage): A2aMessage {
  const src = m as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PUBLIC_TURN_FIELDS) if (src[k] !== undefined) out[k] = src[k];
  return out as unknown as A2aMessage;
}

const clip = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export interface ReasoningOptions {
  agent: string | ((id: string) => boolean);
  question?: string | undefined;
}

/** One card per public decision turn of the agent, oldest first. Built ONLY from public envelope fields. */
export function reasoningCards(messages: readonly A2aMessage[], o: ReasoningOptions): ReasoningCard[] {
  const sorted = sortEnvelopes(messages.map(publicTurn));
  const is = typeof o.agent === 'function' ? o.agent : (id: string) => id === o.agent;
  const byId = new Map(sorted.map((m) => [m.id, m]));
  const cards: ReasoningCard[] = [];
  sorted.forEach((m, i) => {
    if (!is(m.from) || !DECISION_KINDS.has(m.kind)) return;
    if (!m.summary && !m.answer && !m.stance && !m.order?.length) return;
    const parent = m.parentMessageId ? byId.get(m.parentMessageId) : undefined;
    const trigger =
      parent && is(parent.to) && (parent.kind === 'delegate' || parent.kind === 'ask')
        ? parent
        : [...sorted.slice(0, i)]
            .reverse()
            .find((x) => is(x.to) && (x.kind === 'delegate' || x.kind === 'ask'));
    const goal = trigger?.summary
      ? `${a2aPartyName(trigger.from)} asked: ${clip(trigger.summary)}`
      : o.question
        ? clip(o.question)
        : 'Give the council an answer.';
    const text =
      m.order && m.order.length
        ? `Ranked ${m.order.join(', then ')}${m.summary ? `. ${m.summary}` : ''}`
        : (m.answer ?? m.summary ?? m.stance ?? '');
    const nextMsg = sorted.slice(i + 1).find((x) => is(x.from) && x.id !== m.id);
    const actions = m.kind === 'verdict' ? sorted.filter((x) => x.stage === 'actions' && x.summary) : [];
    const next = actions.length
      ? `Action items: ${actions.map((a) => a.summary).join('; ')}`
      : nextMsg
        ? `${PURPOSE_LABEL[nextMsg.kind]} to ${a2aPartyName(nextMsg.to)}${nextMsg.summary ? `: ${clip(nextMsg.summary, 120)}` : ''}`
        : 'No further handoff yet.';
    cards.push({
      id: m.id,
      ts: m.ts,
      stage: m.stage,
      kind: m.kind,
      goal,
      evidence: m.citations ?? [],
      decision: { ...(m.stance ? { stance: m.stance } : {}), text: clip(text, 280) },
      next,
      scripted: m.source === 'script' || modeInfo(m.mode).tier === 'demo',
      mode: m.mode,
    });
  });
  return cards;
}

/* ---------------- provider state ---------------- */

export type ProviderTier = 'live' | 'degraded' | 'fixture';
export interface ProviderState {
  tier: ProviderTier;
  /** 'LIVE: Gemini' | 'DEGRADED: <reason>' | 'FIXTURE: scripted, not Gemini' | 'DEMO: scripted, not Gemini' */
  text: string;
  /** 'Gemini Live (audio + transcript)' | 'Gemini streaming' | 'Scripted (not Gemini)' | 'Transport not reported' */
  transport: string;
}

/** Provider state of a run, from its mode, per-agent modes and transport kind. `fixture` = a replay/scripted board. */
export function providerState(
  run: { mode: string; agents?: readonly { mode: string }[] } | undefined,
  o: { transport?: { kind: string; label?: string } | undefined; fixture?: boolean } = {},
): ProviderState | undefined {
  if (!run) return undefined;
  const modes = [run.mode, ...(run.agents ?? []).map((a) => a.mode)];
  const demo =
    !!o.fixture || o.transport?.kind === 'demo' || modes.some((m) => modeInfo(m).tier === 'demo');
  if (demo)
    return {
      tier: 'fixture',
      text: o.fixture ? 'FIXTURE: scripted, not Gemini' : 'DEMO: scripted, not Gemini',
      transport: 'Scripted (not Gemini)',
    };
  const bad = modes.find((m) => modeInfo(m).tier === 'degraded');
  const t = o.transport;
  const transport = !t
    ? 'Transport not reported'
    : t.kind === 'live-audio'
      ? 'Gemini Live (audio + transcript)'
      : 'Gemini streaming';
  if (bad) {
    const why = modeInfo(bad).word.replace(/^Degraded:?\s*/, '');
    return { tier: 'degraded', text: why ? `DEGRADED: ${why}` : 'DEGRADED', transport };
  }
  return { tier: 'live', text: 'LIVE: Gemini', transport };
}
