import type { RoomOutcome } from '@squad/core';
import type { RankedChapter } from './rank';

export const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
const DAY = 86_400_000;

/** Word-only state, safe for the village (never a box number). */
export function stateWords(r: RankedChapter): string {
  const bits: string[] = [];
  if (!r.practised) bits.push('not practised yet');
  else if (r.due) bits.push(r.box <= 2 ? 'due now, needs review' : 'due for a refresh');
  else bits.push(r.box >= 5 ? 'solid' : r.box >= 3 ? 'getting solid' : 'needs review');
  if (r.weight >= 0.5) bits.push('weighted heavily in past exams');
  else if (r.weight > 0) bits.push('shows up in past exams');
  return bits.join(', ');
}

/** Private detail for the asker's own chat reply (may mention boxes). */
export function privateDetail(r: RankedChapter, nextDue: number | undefined, now: number): string {
  const bits: string[] = [];
  if (!r.practised) bits.push('never practised, due now, box 1 of 5');
  else if (r.due) bits.push(`due now, box ${r.box} of 5`);
  else {
    const days = Math.max(1, Math.round(((nextDue ?? now) - now) / DAY));
    bits.push(
      `${r.box >= 4 ? 'strong' : 'okay'}, next review in ${days} day${days === 1 ? '' : 's'}`,
    );
  }
  if (r.weight >= 0.5) bits.push('weighted heavily in past exams');
  else if (r.weight > 0) bits.push('shows up in past exams');
  return bits.join(', ');
}

/** Workload in words from page counts (never a grade). */
export function oracleWorkloadWords(pages: number): string {
  const hours = Math.round((pages * 8) / 60);
  if (hours <= 1) return 'a light evening';
  return `about ${hours} hours`;
}

export interface OracleOutcomeInput {
  ranked: RankedChapter[];
  /** The chosen top topics, in order, with the 'why' line for each. */
  topics: { chapter: string; title: string; why: string }[];
  pages: number;
}

export function buildOracleOutcome(i: OracleOutcomeInput): RoomOutcome {
  const first = i.topics[0];
  return {
    title: clip(first ? `Study next: ${first.title}` : 'Study next', 120),
    summary: clip(
      `Chapters ranked by what is due for review, what is least practised and what past exams lean on. This is a suggestion, never a grade.`,
      400,
    ),
    items: i.ranked.slice(0, 40).map((r) => ({
      label: clip(`${r.chapter} ${r.title}`, 120),
      detail: clip(stateWords(r), 160),
    })),
    facts: [
      { label: 'Workload', value: clip(oracleWorkloadWords(i.pages), 80) },
      { label: 'Chapters ranked', value: String(i.ranked.length) },
    ],
    why: i.topics.slice(0, 6).map((t) => ({ who: 'oracle', text: clip(t.why, 280) })),
  };
}
