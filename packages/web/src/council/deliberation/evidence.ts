import { modeInfo, type A2aMessage, type BoardRun } from '@squad/village/council';
import type { CouncilStatus } from '@squad/core';
import type { ChipStatus } from '../../primitives/StatusChip';
import { roleKey } from './participants';

/** live | degraded | fixture, the honesty word every card carries. (The wire tier `demo` is shown as Fixture.) */
export function chipStatusOf(mode: string | undefined | null): ChipStatus {
  const t = modeInfo(mode).tier;
  return t === 'demo' ? 'fixture' : t;
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

export interface Consensus {
  level: 'unanimous' | 'majority' | 'split' | 'unknown';
  word: string;
  agree: number;
  total: number;
}

/** How many members' final positions match the Chair's answer. Positions come from answers sent to the Chair. */
export function consensusOf(run: BoardRun): Consensus {
  const answer = norm(run.verdict?.answer);
  const last = new Map<string, A2aMessage>();
  for (const m of run.messages)
    if (m.kind === 'answer' && m.stance && roleKey(m.to) === 'chair') last.set(m.from, m);
  const total = last.size;
  if (!answer || total === 0) return { level: 'unknown', word: 'Not recorded', agree: 0, total };
  const agree = [...last.values()].filter((m) => norm(m.stance) === answer).length;
  if (agree === total)
    return { level: 'unanimous', word: `Unanimous, ${agree} of ${total}`, agree, total };
  if (agree * 2 > total)
    return { level: 'majority', word: `Majority, ${agree} of ${total}`, agree, total };
  return { level: 'split', word: `Split, ${agree} of ${total}`, agree, total };
}

/** Distinct source pages cited anywhere in the run. */
export function sourcesOf(run: BoardRun): { file: string; page: number }[] {
  const seen = new Map<string, { file: string; page: number }>();
  const add = (cs: { file: string; page: number }[] | undefined) =>
    cs?.forEach((c) => seen.set(`${c.file}:${c.page}`, { file: c.file, page: c.page }));
  run.messages.forEach((m) => add(m.citations));
  add(run.verdict?.citations);
  return [...seen.values()];
}

/** What the council could not back with a source. Derived only from public run data; empty when nothing is flagged. */
export function missingEvidence(run: BoardRun): string[] {
  const out: string[] = [];
  const v = run.verdict;
  if (v && v.citations.length === 0) out.push('No course source backs the decision itself.');
  const names = new Map(run.agents.map((a) => [a.id, a.name]));
  const seen = new Set<string>();
  for (const m of run.messages) {
    if (m.kind !== 'answer' || !m.stance || roleKey(m.to) !== 'chair') continue;
    if (seen.has(m.from)) continue;
    seen.add(m.from);
    if (!m.citations || m.citations.length === 0)
      out.push(`${names.get(m.from) ?? 'A member'} cites no source for “${m.stance}”.`);
  }
  for (const a of run.agents)
    if (a.status === 'failed' || a.status === 'partial' || a.status === 'skipped')
      out.push(
        `${a.name} ${a.status === 'failed' ? 'did not answer' : a.status === 'partial' ? 'was cut short' : 'was skipped'}.`,
      );
  return out.slice(0, 5);
}

export interface Provenance {
  mode: ChipStatus;
  provider: string;
  model: string;
  sources: number;
}

/** Provider and model for a run. Fixtures and replays say so plainly instead of naming a model. */
export function provenanceOf(run: BoardRun, status: CouncilStatus | null | 'unknown'): Provenance {
  const mode = chipStatusOf(run.verdict?.mode ?? run.mode);
  const real = status && status !== 'unknown' ? status : null;
  const scripted = mode === 'fixture';
  return {
    mode,
    provider: scripted ? 'Scripted fixture' : real ? real.provider : 'Provider not reported',
    model: scripted ? 'No model' : real ? real.models.chair : 'Model not reported',
    sources: sourcesOf(run).length,
  };
}
