// UTC slot helpers. Hourly slots are 'YYYY-MM-DDTHH', days are 'YYYY-MM-DD'. Windows are [from, to).
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function parseSlot(s: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})(.*))?$/.exec(s);
  if (!m) return NaN;
  const iso = m[2] === undefined ? `${m[1]}T00:00:00Z` : m[3] ? s : `${m[1]}T${m[2]}:00:00Z`;
  return Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
}
export const hourLabel = (ms: number): string => new Date(ms).toISOString().slice(0, 13);
export const dayLabel = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function hoursBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Math.floor(parseSlot(from) / HOUR) * HOUR; t < parseSlot(to); t += HOUR)
    out.push(hourLabel(t));
  return out;
}
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Math.floor(parseSlot(from) / DAY) * DAY; t < parseSlot(to); t += DAY)
    out.push(dayLabel(t));
  return out;
}
export function addDays(day: string, n: number): string {
  return dayLabel(parseSlot(day) + n * DAY);
}
/** Earliest run of `len` consecutive days inside `days` (sorted ascending). */
export function earliestRun(days: readonly string[], len: number): string[] | null {
  const sorted = [...new Set(days)].sort();
  let start = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && parseSlot(sorted[i]!) - parseSlot(sorted[i - 1]!) !== DAY) start = i;
    if (i - start + 1 === len) return sorted.slice(start, i + 1);
  }
  return null;
}
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
export { HOUR, DAY };
