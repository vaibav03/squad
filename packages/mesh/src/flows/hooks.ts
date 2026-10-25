// Participant-side private inputs: PSI item sets and the vectors a student secret-shares.
import type { Payload, SharePurpose } from '../protocol';
import { bordaVector } from '../mediator';
import type { PrivateProfile } from './types';
import { DAY, HOUR, daysBetween, earliestRun, hoursBetween, overlaps, parseSlot } from './time';

export type OpenPayload = Payload<'task.open'>;

export interface TaskView {
  taskId: string;
  open: OpenPayload;
  members: string[]; // sorted
  self: string;
  coordinator: string;
  /** My own resolved common items (hourly slots or days) after psi.common. */
  common: string[];
  dropped: Set<string>;
  candidates: string[];
}

export interface PublicOption {
  id: string;
  label: string;
  perPerson: number;
  days: number;
}

export function optionsOf(open: OpenPayload): PublicOption[] {
  return (open.options ?? []).map((o) => {
    const days = o.dates ? daysBetween(o.dates.from, addOne(o.dates.to)).length : 1;
    return { id: o.id, label: o.label, perPerson: o.perPerson ?? 0, days };
  });
}
const addOne = (day: string): string => new Date(parseSlot(day) + DAY).toISOString().slice(0, 10);

/** Free hourly slots (study) or free days (trip) for this student inside the window. */
export function psiInput(open: OpenPayload, p: PrivateProfile): { items: string[]; padTo: number } {
  const busy = p.calendar.map((e) => [Date.parse(e.start), Date.parse(e.end)] as const);
  if (open.flow === 'study') {
    const items = hoursBetween(open.window.from, open.window.to).filter((h) => {
      const hour = Number(h.slice(11, 13));
      if (hour < p.workHours.startHour || hour >= p.workHours.endHour) return false;
      const s = parseSlot(h);
      return !busy.some(([a, b]) => overlaps(s, s + HOUR, a, b));
    });
    return { items, padTo: 168 };
  }
  const items = daysBetween(open.window.from, open.window.to).filter((d) => {
    const s = parseSlot(d);
    return !busy.some(([a, b]) => overlaps(s, s + DAY, a, b));
  });
  return { items, padTo: 64 };
}

export const vetoes = (p: PrivateProfile, optionId: string): boolean =>
  p.hardNos.some((h) => h.optionId === optionId);

/** The private vector this student secret-shares for (purpose, round). Layout is agreed from public task state. */
export function vectorFor(
  purpose: SharePurpose,
  round: number,
  v: TaskView,
  p: PrivateProfile,
): number[] {
  const opts = optionsOf(v.open);
  switch (purpose) {
    case 'cost': {
      if (round === 0)
        return [...v.common].sort().map((s) => p.hourCost[String(Number(s.slice(11, 13)))] ?? 0);
      // round 1: busy bit over every hourly slot in the window
      const free = new Set(psiInput(v.open, p).items);
      return hoursBetween(v.open.window.from, v.open.window.to).map((h) => (free.has(h) ? 0 : 1));
    }
    case 'weakTopic':
      return (v.open.topics ?? []).map((t) => (p.topics.weak.includes(t) ? 1 : 0));
    case 'cantAfford':
      return opts.map((o) => (o.perPerson > p.budget ? 1 : 0));
    case 'veto':
      return opts.map((o) => (vetoes(p, o.id) ? 1 : 0));
    case 'borda': {
      const survivors = opts.filter((o) => !v.dropped.has(o.id)).map((o) => o.id);
      return bordaVector(p.tripRanking, survivors);
    }
    case 'simulate':
      return v.candidates.map((id) => {
        const o = opts.find((x) => x.id === id);
        if (!o) return 1;
        const run = earliestRun(v.common, o.days);
        const total = o.perPerson + (p.tripExtrasPerDay ?? 0) * o.days;
        return total > p.budget || vetoes(p, id) || !run ? 1 : 0;
      });
  }
}

/** The student's own raw withheld value for a ledger field (owner view only; never leaves via events). */
export function rawWithheld(field: string, p: PrivateProfile): string {
  switch (field) {
    case 'budget':
      return `$${p.budget} cap`;
    case 'calendar':
      return p.calendar.map((e) => e.title).join('; ') || 'busy hours';
    case 'hardNo':
      return p.hardNos.map((h) => h.reason).join('; ') || 'none';
    case 'topics':
      return p.topics.weak.join(', ') || 'none';
    case 'vote':
      return p.tripRanking.join(' > ');
    case 'softCost':
      return Object.entries(p.hourCost)
        .map(([h, c]) => `${h}:00 cost ${c}`)
        .join(', ');
    default:
      return 'private';
  }
}

/** Limits shown to the owner on the trip page. */
export function ownLimits(p: PrivateProfile): Record<string, string> {
  return {
    budget: `$${p.budget} cap`,
    ...(p.tripExtrasPerDay ? { extras: `$${p.tripExtrasPerDay} per day` } : {}),
    ...(p.hardNos.length ? { hardNo: p.hardNos.map((h) => h.reason).join('; ') } : {}),
  };
}
