// Pure, dependency-free time zone and cron helpers for proactive features. DST-correct: all calendar
// arithmetic happens on local wall-clock fields and is converted to UTC per instant via Intl.
//
// DST policy (documented in docs/proactive.md):
//  - a local time that does not exist (spring-forward gap) fires shifted forward by the gap length;
//  - a local time that occurs twice (fall-back) fires at its FIRST occurrence only, never twice.

export interface ZonedParts {
  y: number;
  mo: number; // 1..12
  d: number;
  h: number;
  mi: number;
  s: number;
  dow: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ms: number, tz: string): ZonedParts {
  const o: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: Number(o.year),
    mo: Number(o.month),
    d: Number(o.day),
    h: Number(o.hour) % 24,
    mi: Number(o.minute),
    s: Number(o.second),
    dow: DOW[o.weekday!] ?? 0,
  };
}

/** Offset of `tz` from UTC at instant `ms` (local = utc + offset). */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Local wall-clock fields to a UTC instant (see the DST policy above). Fields may overflow (d+1 etc). */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off1 = tzOffsetMs(guess, tz);
  const t1 = guess - off1;
  const off2 = tzOffsetMs(t1, tz);
  if (off1 === off2) return t1;
  const t2 = guess - off2;
  if (tzOffsetMs(t2, tz) === off2) return t2;
  return t1; // gap: shift forward by the gap length
}

export function addDays(y: number, mo: number, d: number, n: number) {
  const t = new Date(Date.UTC(y, mo - 1, d + n));
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

/** [start, end) of the local calendar day `dayOffset` days from the day containing `ms`. */
export function localDayRange(ms: number, tz: string, dayOffset = 0): [number, number] {
  const p = zonedParts(ms, tz);
  const a = addDays(p.y, p.mo, p.d, dayOffset);
  const b = addDays(p.y, p.mo, p.d, dayOffset + 1);
  return [zonedToUtc(a.y, a.mo, a.d, 0, 0, tz), zonedToUtc(b.y, b.mo, b.d, 0, 0, tz)];
}

// ---- cron ---------------------------------------------------------------------------------------

interface CronSpec {
  minutes: number[];
  hours: number[];
  doms: number[];
  months: number[];
  dows: number[];
  domStar: boolean;
  dowStar: boolean;
}

function field(src: string, lo: number, hi: number, name: string): number[] {
  const out = new Set<number>();
  for (const part of src.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`bad cron ${name} field "${src}"`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`bad cron ${name} step "${src}"`);
    let a = lo;
    let b = hi;
    if (m[1] !== '*') {
      const [x, y] = m[1]!.split('-');
      a = Number(x);
      b = y === undefined ? (m[2] ? hi : a) : Number(y);
    }
    if (a < lo || b > hi || a > b) throw new Error(`cron ${name} out of range "${src}"`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

const specCache = new Map<string, CronSpec>();

export function parseCron(expr: string): CronSpec {
  const hit = specCache.get(expr);
  if (hit) return hit;
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron needs 5 fields (m h dom mon dow): "${expr}"`);
  const dows = field(f[4]!, 0, 7, 'dow').map((v) => v % 7);
  const spec: CronSpec = {
    minutes: field(f[0]!, 0, 59, 'minute'),
    hours: field(f[1]!, 0, 23, 'hour'),
    doms: field(f[2]!, 1, 31, 'day-of-month'),
    months: field(f[3]!, 1, 12, 'month'),
    dows: [...new Set(dows)].sort((x, y) => x - y),
    domStar: f[2] === '*',
    dowStar: f[4] === '*',
  };
  specCache.set(expr, spec);
  return spec;
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(s: CronSpec, mo: number, d: number, dow: number): boolean {
  if (!s.months.includes(mo)) return false;
  const dm = s.doms.includes(d);
  const wm = s.dows.includes(dow);
  if (s.domStar && s.dowStar) return true;
  if (s.domStar) return wm;
  if (s.dowStar) return dm;
  return dm || wm; // vixie: both restricted means either
}

/** First fire time strictly after `afterMs` for a 5-field cron in `tz`, or undefined within ~5 years. */
export function nextCron(expr: string, afterMs: number, tz: string): number | undefined {
  const s = parseCron(expr);
  const p = zonedParts(afterMs, tz);
  for (let i = 0; i < 366 * 5; i++) {
    const day = addDays(p.y, p.mo, p.d, i);
    if (!dayMatches(s, day.mo, day.d, day.dow)) continue;
    for (const h of s.hours) {
      for (const m of s.minutes) {
        const t = zonedToUtc(day.y, day.mo, day.d, h, m, tz);
        if (t > afterMs) return t;
      }
    }
  }
  return undefined;
}

// ---- quiet hours --------------------------------------------------------------------------------

export interface QuietHours {
  start: string; // 'HH:MM' local
  end: string; // 'HH:MM' local (may be earlier than start: overnight)
}

const hm = (s: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`bad time "${s}" (HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

export function inQuietHours(ms: number, tz: string, q: QuietHours): boolean {
  const p = zonedParts(ms, tz);
  const cur = p.h * 60 + p.mi;
  const a = hm(q.start);
  const b = hm(q.end);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}

/** First instant at or after `ms` that is outside quiet hours (ms itself when not quiet). */
export function quietEnd(ms: number, tz: string, q: QuietHours): number {
  if (!inQuietHours(ms, tz, q)) return ms;
  const p = zonedParts(ms, tz);
  const endMin = hm(q.end);
  const cur = p.h * 60 + p.mi;
  const dayOff = endMin > cur ? 0 : 1;
  const day = addDays(p.y, p.mo, p.d, dayOff);
  return zonedToUtc(day.y, day.mo, day.d, Math.floor(endMin / 60), endMin % 60, tz);
}

export function formatLocal(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms));
}
