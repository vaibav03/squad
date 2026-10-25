import { meetsMinGroupSize } from '@squad/core';
import { deriveTripConstraints, type AskViewerData, type MasteryStore } from '@squad/brain';
import { contextServiceFor } from '../context/service';
import type { HubDeps } from '../types';

/**
 * Viewer data ports for council agents (`calendar_summary`, `mastery_summary`). Both are scoped to the ASKER:
 *  - calendar: derived busy/free numbers from the asker's connected calendars (deriveTripConstraints: start/end only,
 *    no titles), plus a squad aggregate only when 3+ squadmates have connected calendars;
 *  - mastery: the asker's own words and pips per chapter, plus the squad aggregate only with 3+ members.
 * Other students' individual data is never returned. Event titles of the asker are handed back as `needles` so the
 * runtime scrubs them if a model ever repeats one.
 */
export interface ViewerDataOpts {
  courseId: () => string;
  mastery?: MasteryStore;
  /** Chapter ids and titles of the course (titles are public course structure). */
  chapters?: (courseId: string) => { id: string; title: string }[];
}

const DAY = 24 * 3_600_000;
const WAKE_HOURS = 14; // 08:00 to 22:00
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WORDS = ['Not started', 'Learning', 'Learning', 'Getting there', 'Solid', 'Solid'];

export const pipsOf = (box: number): number =>
  Number.isFinite(box) ? Math.min(5, Math.max(0, Math.round(box))) : 0;
export const wordOf = (box: number): string => WORDS[pipsOf(box)]!;

export function parseRange(range: string, now: number): { days: number; label: string } {
  const t = range.toLowerCase();
  if (/\btoday\b/.test(t)) return { days: 1, label: 'Today' };
  if (/\btomorrow\b/.test(t)) return { days: 2, label: 'Today and tomorrow' };
  const n = /\b(\d{1,3})\s*days?\b/.exec(t);
  if (n) {
    const d = Math.min(30, Math.max(1, Number(n[1])));
    return { days: d, label: `Next ${d} days` };
  }
  if (/\b(term|semester)\b/.test(t)) return { days: 30, label: 'Next 30 days' };
  void now;
  return { days: 7, label: 'Next 7 days' };
}

interface Busy {
  start: string;
  end: string;
}

/** Busy hours per UTC day for the window, clipped to each day. */
function busyByDay(busy: Busy[], from: number, days: number): number[] {
  const out = new Array<number>(days).fill(0);
  for (const b of busy) {
    const s = Date.parse(b.start);
    const e = Date.parse(b.end);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    for (let d = 0; d < days; d++) {
      const lo = Math.max(s, from + d * DAY);
      const hi = Math.min(e, from + (d + 1) * DAY);
      if (hi > lo) out[d]! += (hi - lo) / 3_600_000;
    }
  }
  return out.map((h) => Math.min(WAKE_HOURS, h));
}

const hrs = (h: number): string => `${Math.round(h * 10) / 10}`.replace(/\.0$/, '');

export function createCouncilViewerData(
  deps: HubDeps,
  o: ViewerDataOpts,
): (askedBy: string, visibility: 'squad' | 'private') => AskViewerData | undefined {
  const store = () => contextServiceFor(deps).store;

  const constraints = (student: string, from: number, to: number) =>
    deriveTripConstraints(store(), [student], { from, to }, {})[0];

  const hasCalendar = (student: string): boolean =>
    store()
      .connectionsOf(student)
      .some((c) => store().sourcesOfConnection(c.id).length > 0);

  const squadMates = (student: string): string[] => {
    const sq = deps.directory.squadOf(student);
    return sq ? (deps.directory.squad(sq)?.members ?? []).filter((m) => m !== student) : [];
  };

  return (askedBy, visibility) => {
    const calendarSummary = async (range: string) => {
      const now = deps.now();
      const { days, label } = parseRange(range, now);
      const from = Math.floor(now / DAY) * DAY;
      const to = from + days * DAY;
      const mine = constraints(askedBy, from, to);
      if (!hasCalendar(askedBy))
        return { text: 'No calendar is connected, so free time is unknown.' };
      const per = busyByDay(mine?.busy ?? [], from, days);
      const busy = per.reduce((a, b) => a + b, 0);
      const free = days * WAKE_HOURS - busy;
      const ranked = per
        .map((h, i) => ({ h, name: WEEKDAY[new Date(from + i * DAY).getUTCDay()]! }))
        .sort((a, b) => b.h - a.h);
      const busiest = ranked
        .filter((r) => r.h > 0)
        .slice(0, 2)
        .map((r) => r.name);
      const freest = [...ranked].reverse()[0];
      const lines = [
        `${label}: about ${hrs(busy)} busy hours and ${hrs(free)} free hours (waking hours, 8am to 10pm).`,
        ...(busiest.length ? [`Busiest days: ${busiest.join(', ')}.`] : ['Nothing is booked.']),
        ...(freest && days > 1 ? [`Freest day: ${freest.name}.`] : []),
      ];
      // squad aggregate: only when 3+ squadmates (not counting the asker) have connected calendars
      if (visibility === 'squad') {
        const others = squadMates(askedBy).filter(hasCalendar);
        if (meetsMinGroupSize(others.length)) {
          const totals = others.map((m) =>
            busyByDay(constraints(m, from, to)?.busy ?? [], from, days).reduce((a, b) => a + b, 0),
          );
          const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
          lines.push(`Squad average: about ${hrs(avg / days)} busy hours a day.`);
        }
      }
      return { text: lines.join(' ') };
    };

    const masterySummary = o.mastery
      ? async () => {
          const courseId = o.courseId();
          const m = o.mastery!;
          const titles = new Map((o.chapters?.(courseId) ?? []).map((c) => [c.id, c.title]));
          const rows = m.forStudent(askedBy, courseId);
          if (rows.length === 0) return { text: 'No chapters started yet.' };
          const name = (id: string) => titles.get(id) ?? id;
          const mates = squadMates(askedBy);
          const showSquad = visibility === 'squad' && meetsMinGroupSize(mates.length + 1);
          const squadRows = showSquad
            ? new Map(
                mates.map((s) => [
                  s,
                  new Map(m.forStudent(s, courseId).map((r) => [r.chapter, r.box])),
                ]),
              )
            : undefined;
          const lines = rows.map((r) => {
            let line = `${name(r.chapter)}: ${wordOf(r.box)} (${pipsOf(r.box)} of 5 pips)`;
            if (squadRows) {
              const boxes = [r.box, ...[...squadRows.values()].map((x) => x.get(r.chapter) ?? 0)];
              const avg = boxes.reduce((a, b) => a + b, 0) / boxes.length;
              line += `; squad average ${wordOf(avg)}`;
            }
            return line;
          });
          return { text: lines.join('. ') + '.' };
        }
      : undefined;

    // private strings of the asker (event and assignment titles) so the runtime can scrub them from public text
    const needles = (() => {
      try {
        return store()
          .connectionsOf(askedBy)
          .flatMap((c) => store().sourcesOfConnection(c.id))
          .map((s) => s.title.trim())
          .filter((t) => t.length >= 4);
      } catch {
        return [];
      }
    })();

    return {
      calendarSummary,
      ...(masterySummary ? { masterySummary } : {}),
      ...(needles.length ? { needles: [...new Set(needles)].slice(0, 50) } : {}),
    };
  };
}
