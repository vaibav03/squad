// Minimal .ics import (VEVENT DTSTART/DTEND/SUMMARY, UTC or floating-as-UTC, all-day dates, line folding).
// Mock calendars first; Google freeBusy is a later ticket (src/google.ts).
import type { PrivateProfile } from '@squad/mesh';

type Ev = PrivateProfile['calendar'][number];

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

function toIso(v: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(v.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}Z`;
}

export function parseIcs(text: string): Ev[] {
  const out: Ev[] = [];
  let cur: (Partial<Ev> & { allDayEnd?: boolean }) | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      if (cur.start && cur.end)
        out.push({ start: cur.start, end: cur.end, title: cur.title ?? '' });
      else if (cur.start)
        out.push({
          start: cur.start,
          end: new Date(Date.parse(cur.start) + 3_600_000).toISOString().replace('.000', ''),
          title: cur.title ?? '',
        });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const name = line.slice(0, i).split(';')[0]!.toUpperCase();
      const value = line.slice(i + 1);
      if (name === 'DTSTART') cur.start = toIso(value) ?? undefined;
      else if (name === 'DTEND') cur.end = toIso(value) ?? undefined;
      else if (name === 'SUMMARY') cur.title = value.replace(/\\,/g, ',').replace(/\\n/gi, ' ');
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function importIcs(profile: PrivateProfile, ics: string): PrivateProfile {
  return { ...profile, calendar: parseIcs(ics) };
}
