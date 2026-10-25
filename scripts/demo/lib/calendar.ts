/**
 * Tiny iCalendar reader for the seed pack (VEVENT with DTSTART/DTEND, TZID=America/Phoenix or UTC).
 * All times are normalised to "floating local" minutes-since-epoch in America/Phoenix (UTC-7, no DST),
 * stored as ms via Date.UTC so arithmetic is deterministic regardless of the machine's timezone.
 */
const PHOENIX_OFFSET_MS = 7 * 3600_000;

export interface IcsEvent {
  uid: string;
  summary: string;
  start: number; // local-as-UTC ms
  end: number;
}

function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function parseStamp(prop: string, value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) throw new Error(`unsupported date value "${value}"`);
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
  if (m[7] === 'Z') return ms - PHOENIX_OFFSET_MS;
  const tz = /TZID=([^;:]+)/.exec(prop)?.[1];
  if (tz !== undefined && tz !== 'America/Phoenix') throw new Error(`unsupported TZID ${tz}`);
  return ms;
}

/** Throws with a clear message when the file is not a usable calendar. */
export function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text);
  if (lines[0]?.trim() !== 'BEGIN:VCALENDAR') throw new Error('missing BEGIN:VCALENDAR');
  if (!lines.some((l) => l.trim() === 'END:VCALENDAR')) throw new Error('missing END:VCALENDAR');
  if (!lines.some((l) => l.trim() === 'VERSION:2.0')) throw new Error('missing VERSION:2.0');
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | undefined;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') {
      if (!cur || cur.start === undefined || cur.end === undefined || !cur.uid)
        throw new Error('VEVENT needs UID, DTSTART and DTEND');
      if (cur.end <= cur.start) throw new Error(`VEVENT ${cur.uid} ends before it starts`);
      events.push({ uid: cur.uid, summary: cur.summary ?? '', start: cur.start, end: cur.end });
      cur = undefined;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const prop = line.slice(0, i);
      const val = line.slice(i + 1);
      const name = prop.split(';')[0];
      if (name === 'UID') cur.uid = val;
      else if (name === 'SUMMARY') cur.summary = val;
      else if (name === 'DTSTART') cur.start = parseStamp(prop, val);
      else if (name === 'DTEND') cur.end = parseStamp(prop, val);
    }
  }
  if (cur) throw new Error('unterminated VEVENT');
  return events;
}

export interface WindowSpec {
  from: string; // 'YYYY-MM-DDTHH:MM' local
  to: string;
  dayStartHour: number;
  dayEndHour: number;
  durationHours: number;
}

const localMs = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad local time ${s}`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
};

const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 16);

/** Start times ('YYYY-MM-DDTHH:MM') of every `durationHours` run where all calendars are free, hourly grid. */
export function commonFreeWindows(
  calendars: Record<string, readonly IcsEvent[]>,
  spec: WindowSpec,
  skipEventUids: readonly string[] = [],
): string[] {
  const from = localMs(spec.from);
  const to = localMs(spec.to);
  const skip = new Set(skipEventUids);
  const busy = Object.values(calendars).flatMap((c) => c.filter((e) => !skip.has(e.uid)));
  const HOUR = 3600_000;
  const free = (h: number) => !busy.some((e) => e.start < h + HOUR && e.end > h);
  const out: string[] = [];
  for (let day = Math.floor(from / 86400_000) * 86400_000; day < to; day += 86400_000) {
    for (let hr = spec.dayStartHour; hr + spec.durationHours <= spec.dayEndHour; hr++) {
      const start = day + hr * HOUR;
      const end = start + spec.durationHours * HOUR;
      if (start < from || end > to) continue;
      let ok = true;
      for (let t = start; t < end; t += HOUR) if (!free(t)) ok = false;
      if (ok) out.push(fmt(start));
    }
  }
  return out;
}
