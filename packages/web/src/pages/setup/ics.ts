export interface BusyBlock {
  /** ISO string, UTC */
  start: string;
  end: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

/** Parses an ICS date or date-time value. Floating times are read as local time. Returns null when malformed. */
export function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  const v = value.trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : { date: d, allDay: true };
  }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, da, h, mi, s] = m.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const d = m[7] ? new Date(Date.UTC(y, mo - 1, da, h, mi, s)) : new Date(y, mo - 1, da, h, mi, s);
  return Number.isNaN(d.getTime()) ? null : { date: d, allDay: false };
}

/**
 * Extracts busy blocks from ICS text. Only start and end survive: titles, locations and notes are never read
 * into the result. All-day events and anything malformed, transparent (free) or cancelled are skipped.
 */
export function parseIcs(text: string): BusyBlock[] {
  const out: BusyBlock[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (cur) {
        const s = cur.DTSTART ? parseIcsDate(cur.DTSTART) : null;
        const e = cur.DTEND ? parseIcsDate(cur.DTEND) : null;
        const free = cur.TRANSP === 'TRANSPARENT' || cur.STATUS === 'CANCELLED';
        if (s && e && !s.allDay && !e.allDay && e.date > s.date && !free) {
          out.push({ start: s.date.toISOString(), end: e.date.toISOString() });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 1) continue;
    const name = line.slice(0, idx).split(';')[0]!.toUpperCase();
    if (name === 'DTSTART' || name === 'DTEND' || name === 'TRANSP' || name === 'STATUS')
      cur[name] = line.slice(idx + 1);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}
