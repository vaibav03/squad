import { meetsMinGroupSize } from '@squad/core';

const HOUR = 3_600_000;
/** Parse '2026-11-03T14' / full ISO as UTC. */
function slotMs(slot: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})(.*))?$/.exec(slot);
  if (!m) return NaN;
  const iso = m[2] === undefined ? `${m[1]}T00:00:00Z` : m[3] ? slot : `${m[1]}T${m[2]}:00:00Z`;
  return Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
}

export interface StudyInput {
  commonSlots: string[];
  costTotals?: Record<string, number>;
  examAt?: string;
  minLeadHours?: number;
  memberCount: number;
  conflictCounts?: Record<string, number>;
}
export type StudyChoice =
  | { kind: 'slot'; slot: string; costTotal: number | null }
  | { kind: 'conflict'; reason: 'no_common_slot'; hybrid: { slot: string } | null };

export function chooseStudySlot(i: StudyInput): StudyChoice {
  const lead = (i.minLeadHours ?? 1) * HOUR;
  const exam = i.examAt ? slotMs(i.examAt) : NaN;
  const ok = [...new Set(i.commonSlots)]
    .filter((s) => Number.isNaN(exam) || slotMs(s) + lead <= exam)
    .sort();
  const show = meetsMinGroupSize(i.memberCount);
  if (ok.length > 0) {
    let best = ok[0]!;
    let bestCost = i.costTotals?.[best] ?? 0;
    for (const s of ok) {
      const c = i.costTotals?.[s] ?? 0;
      if (c < bestCost) {
        best = s;
        bestCost = c;
      }
    }
    return { kind: 'slot', slot: best, costTotal: show && i.costTotals ? bestCost : null };
  }
  let hybrid: string | null = null;
  let hc = Infinity;
  for (const [s, c] of Object.entries(i.conflictCounts ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!Number.isNaN(exam) && slotMs(s) + lead > exam) continue;
    if (c < hc) {
      hc = c;
      hybrid = s;
    }
  }
  return { kind: 'conflict', reason: 'no_common_slot', hybrid: hybrid ? { slot: hybrid } : null };
}

export interface TopicCoverage {
  topic: string;
  weak: number | null;
  lead: string | null;
}

export function topicCoverage(i: {
  canTeach: Record<string, string[]>;
  weakTotals: Record<string, number>;
  memberCount: number;
}): TopicCoverage[] {
  if (!meetsMinGroupSize(i.memberCount)) return [];
  return Object.entries(i.weakTotals)
    .filter(([, n]) => n > 0)
    .sort(([ta, a], [tb, b]) => b - a || (ta < tb ? -1 : 1))
    .map(([topic, weak]) => ({ topic, weak, lead: [...(i.canTeach[topic] ?? [])].sort()[0] ?? null }));
}
