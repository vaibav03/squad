// Pure helpers for collaborative trips: dates, tally, recommendation text. No IO, no clocks except what is passed in.
import type { TripRecord } from '../types';

export const DAY_MS = 86_400_000;
export const MAX_WINDOW_DAYS = 62;
export const DEFAULT_DEADLINE_MS = 48 * 3_600_000;

/** Public, labelled estimates the council may seed. Quotes are placeholders members can edit. */
export const CATALOG: { label: string; days: number; perPerson: number }[] = [
  { label: 'Flagstaff', days: 3, perPerson: 142 },
  { label: 'Austin', days: 3, perPerson: 320 },
  { label: 'Lake Tahoe', days: 3, perPerson: 410 },
  { label: 'Lake Day', days: 2, perPerson: 90 },
  { label: 'Cabo', days: 4, perPerson: 650 },
];

export const slug = (label: string): string =>
  label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'option';

export const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const parse = (d: string): number => Date.parse(`${d}T00:00:00Z`);

export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
export const monthOf = (word: string): number | undefined => {
  const w = word.toLowerCase();
  if (w.length < 3) return undefined;
  const i = MONTHS.findIndex(
    (m) => m === w || (w.length >= 3 && m.startsWith(w) && w.length <= m.length),
  );
  return i >= 0 ? i + 1 : undefined;
};

/** Window for a month name: the next occurrence of that month, never starting before tomorrow. */
export function monthWindow(month: number, nowMs: number): { from: string; to: string } {
  const now = new Date(nowMs);
  let year = now.getUTCFullYear();
  const end = (y: number) => Date.UTC(y, month, 0); // last day of `month` (1-based) at 00:00Z
  if (end(year) < nowMs) year += 1;
  const first = Date.UTC(year, month - 1, 1);
  const tomorrow = parse(iso(nowMs)) + DAY_MS;
  return { from: iso(Math.max(first, tomorrow)), to: iso(end(year)) };
}

export function defaultWindow(nowMs: number): { from: string; to: string } {
  const from = parse(iso(nowMs)) + 7 * DAY_MS;
  return { from: iso(from), to: iso(from + 30 * DAY_MS) };
}

/** Earliest run of `days` consecutive dates inside the sorted free days, or null. */
export function earliestRun(free: readonly string[], days: number): string[] | null {
  const f = [...free].sort();
  for (let i = 0; i + days <= f.length; i++) {
    let ok = true;
    for (let k = 1; k < days; k++)
      if (parse(f[i + k]!) - parse(f[i + k - 1]!) !== DAY_MS) ok = false;
    if (ok) return f.slice(i, i + days);
  }
  return null;
}

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const fmtDay = (d: string): string => SHORT.format(new Date(parse(d)));
export const fmtRange = (d: string[]): string =>
  d.length === 0 ? '' : d.length === 1 ? fmtDay(d[0]!) : `${fmtDay(d[0]!)} to ${fmtDay(d.at(-1)!)}`;

/** Compress sorted days into "Mar 3 to Mar 9, Mar 12". */
export function fmtDays(days: readonly string[]): string {
  const f = [...days].sort();
  const runs: string[][] = [];
  for (const d of f) {
    const last = runs.at(-1);
    if (last && parse(d) - parse(last.at(-1)!) === DAY_MS) last.push(d);
    else runs.push([d]);
  }
  return runs.map(fmtRange).join(', ');
}

export const money = (n: number): string => (n > 0 ? `$${n}` : 'no quote yet');

/** Borda over the ballots: first choice gets n-1 points, unranked options 0. Ties: cheaper (known quote first), then order. */
export function tally(
  t: Pick<TripRecord, 'options' | 'votes' | 'vetoed'>,
  perPerson: (id: string) => number,
): { optionId: string; points: number }[] {
  const live = t.options.filter((o) => !t.vetoed.some((v) => v.optionId === o.id));
  const n = live.length;
  const pts = new Map(live.map((o) => [o.id, 0]));
  for (const v of t.votes) {
    const r = v.ranking.filter((id) => pts.has(id));
    r.forEach((id, i) => pts.set(id, (pts.get(id) ?? 0) + (n - 1 - i)));
  }
  const order = new Map(live.map((o, i) => [o.id, i]));
  return live
    .map((o) => ({ optionId: o.id, points: pts.get(o.id) ?? 0 }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const ca = perPerson(a.optionId) || Infinity;
      const cb = perPerson(b.optionId) || Infinity;
      if (ca !== cb) return ca - cb;
      return (order.get(a.optionId) ?? 0) - (order.get(b.optionId) ?? 0);
    });
}

export interface RecoInput {
  options: { id: string; label: string; days: number; perPerson: number }[];
  droppedIds: string[];
  overlap: string[] | null;
  /** Leading option from the ballots, only passed once 3+ members voted. */
  leader: string | null;
  skippedFor: string[];
}
export interface RecoText {
  optionId: string | null;
  chair: string;
  planner: string;
  dissent: string[];
}

/** The council's deterministic reading of public facts (never limits, never ballots below 3 voters). */
export function recommend(i: RecoInput): RecoText {
  const live = i.options.filter((o) => !i.droppedIds.includes(o.id));
  const fits = (o: { days: number }) =>
    i.overlap === null || earliestRun(i.overlap, o.days) !== null;
  const viable = live.filter(fits);
  const dissent: string[] = [];
  if (live.length === 0)
    return {
      optionId: null,
      chair: 'No option survives the group limits yet. Propose another destination.',
      planner: 'Nothing to date until at least one option fits everyone.',
      dissent: ['Skeptic: every option was ruled out by a budget or a hard no (not saying whose).'],
    };
  if (viable.length === 0)
    return {
      optionId: null,
      chair: 'No option fits inside the days everyone is free.',
      planner: `Shared free days: ${i.overlap && i.overlap.length ? fmtDays(i.overlap) : 'none'}. Try shorter trips.`,
      dissent: ['Skeptic: the longest options need more consecutive free days than the squad has.'],
    };
  const known = viable.filter((o) => o.perPerson > 0);
  const byCost = [...(known.length ? known : viable)].sort((a, b) => a.perPerson - b.perPerson);
  const pick = (i.leader && viable.find((o) => o.id === i.leader)) || byCost[0]!;
  const run = i.overlap ? earliestRun(i.overlap, pick.days) : null;
  const why =
    i.leader && pick.id === i.leader
      ? 'it is ahead on the secret ballots'
      : known.length
        ? 'it is the cheapest that fits everyone'
        : 'it fits the shared days';
  const chair = `Go with ${pick.label}: ${why}.`;
  const planner = run
    ? `${fmtRange(run)}, ${pick.days} day${pick.days === 1 ? '' : 's'}, ${money(pick.perPerson)} each.`
    : i.overlap === null
      ? `${pick.days} days, ${money(pick.perPerson)} each. Dates not checked against calendars.`
      : `${pick.days} days, ${money(pick.perPerson)} each.`;
  if (i.overlap && i.overlap.length - pick.days < 2)
    dissent.push(
      `Skeptic: only ${i.overlap.length} shared free day${i.overlap.length === 1 ? '' : 's'}, almost no slack if plans shift.`,
    );
  if (i.droppedIds.length)
    dissent.push(
      `Skeptic: ${i.droppedIds.length} option${i.droppedIds.length === 1 ? ' was' : 's were'} dropped because a budget or hard no rules ${i.droppedIds.length === 1 ? 'it' : 'them'} out (not saying whose).`,
    );
  if (i.skippedFor.length)
    dissent.push(`Skeptic: calendars and budgets were not checked for ${i.skippedFor.join(', ')}.`);
  if (pick.perPerson === 0) dissent.push('Skeptic: there is no price quote for this option yet.');
  const other = viable.filter((o) => o.id !== pick.id).sort((a, b) => a.perPerson - b.perPerson)[0];
  if (other)
    dissent.push(
      `Skeptic: ${other.label} also fits${other.perPerson && pick.perPerson && other.perPerson < pick.perPerson ? ` and costs ${money(pick.perPerson - other.perPerson)} less` : ''}; the vote can still change this.`,
    );
  else dissent.push('Skeptic: only one option survived. Consider proposing another.');
  return { optionId: pick.id, chair, planner, dissent };
}
