import type { PlanSeed } from './context';

const DUE_KINDS = new Set(['canvas_assignment', 'classroom_item']);
const FILE_KINDS = new Set(['gdoc', 'gdrive_file']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface CiteLike {
  label: string;
  source?: { kind: string; id: string } | undefined;
}

/** "Title, due Wednesday, Oct 28, 11:59 PM UTC" -> `YYYY-MM-DD` (year rolls forward when the date already passed). */
function dueDay(label: string, now: Date): string | null {
  const m = /due [A-Za-z]+, ([A-Z][a-z]{2}) (\d{1,2})/.exec(label);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1]!);
  if (mon < 0) return null;
  let y = now.getUTCFullYear();
  if (Date.UTC(y, mon, +m[2]! + 1) < now.getTime() - 86_400_000) y += 1;
  return new Date(Date.UTC(y, mon, +m[2]!)).toISOString().slice(0, 10);
}

/** What "Plan from this answer" carries: the cited due items (latest date = plan deadline) and files, as chips. */
export function seedFromCitations(cites: readonly CiteLike[], now = new Date()): PlanSeed | null {
  const due = cites.filter((c) => c.source && DUE_KINDS.has(c.source.kind));
  if (due.length === 0) return null;
  const days = due.map((c) => dueDay(c.label, now)).filter((d): d is string => !!d).sort();
  if (days.length === 0) return null;
  const used = cites.filter((c) => c.source && (DUE_KINDS.has(c.source.kind) || FILE_KINDS.has(c.source.kind)));
  return {
    examDate: days[days.length - 1]!,
    label: 'Canvas due items',
    sourceIds: due.map((c) => c.source!.id),
    chips: used.map((c) => ({ id: c.source!.id, label: c.label, kind: c.source!.kind })),
  };
}
