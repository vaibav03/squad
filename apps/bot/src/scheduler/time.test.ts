import { describe, expect, it } from 'vitest';
import {
  inQuietHours,
  isValidCron,
  isValidTz,
  localDayRange,
  nextCron,
  quietEnd,
  zonedParts,
  zonedToUtc,
} from '@squad/brain';

const iso = (ms: number | undefined) => new Date(ms!).toISOString();
const NY = 'America/New_York';

describe('time zones', () => {
  it('converts local wall time to UTC around the offset', () => {
    expect(iso(zonedToUtc(2026, 10, 26, 21, 0, NY))).toBe('2026-10-27T01:00:00.000Z'); // EDT
    expect(iso(zonedToUtc(2026, 11, 2, 21, 0, NY))).toBe('2026-11-03T02:00:00.000Z'); // EST
    expect(iso(zonedToUtc(2026, 10, 26, 21, 0, 'Asia/Kolkata'))).toBe('2026-10-26T15:30:00.000Z');
  });
  it('reads local parts', () => {
    const p = zonedParts(Date.UTC(2026, 9, 27, 1, 0), NY);
    expect(p).toMatchObject({ y: 2026, mo: 10, d: 26, h: 21, mi: 0, dow: 1 });
  });
  it('validates names', () => {
    expect(isValidTz('Europe/Paris')).toBe(true);
    expect(isValidTz('Mars/Olympus')).toBe(false);
  });
  it('local day range is 23 h on spring-forward and 25 h on fall-back', () => {
    const [a, b] = localDayRange(Date.UTC(2026, 2, 8, 12), NY);
    expect((b - a) / 3_600_000).toBe(23);
    const [c, d] = localDayRange(Date.UTC(2026, 10, 1, 12), NY);
    expect((d - c) / 3_600_000).toBe(25);
  });
});

describe('cron', () => {
  it('fires at the same local time across DST (UTC gap is 23 h then 25 h)', () => {
    const d0 = nextCron('0 21 * * *', Date.UTC(2026, 2, 7, 12), NY)!; // Sat Mar 7 21:00 EST
    const d1 = nextCron('0 21 * * *', d0, NY)!; // Sun Mar 8 21:00 EDT
    expect(iso(d0)).toBe('2026-03-08T02:00:00.000Z');
    expect(iso(d1)).toBe('2026-03-09T01:00:00.000Z');
    expect((d1 - d0) / 3_600_000).toBe(23);
    const f0 = nextCron('0 21 * * *', Date.UTC(2026, 9, 31, 12), NY)!; // Oct 31 EDT
    const f1 = nextCron('0 21 * * *', f0, NY)!; // Nov 1 EST
    expect((f1 - f0) / 3_600_000).toBe(25);
  });
  it('a nonexistent local time (02:30 on spring-forward) fires once, shifted forward', () => {
    const t = nextCron('30 2 * * *', Date.UTC(2026, 2, 8, 0), NY)!;
    expect(iso(t)).toBe('2026-03-08T07:30:00.000Z'); // 03:30 EDT
    expect(iso(nextCron('30 2 * * *', t, NY))).toBe('2026-03-09T06:30:00.000Z');
  });
  it('an ambiguous local time (01:30 on fall-back) fires exactly once, at its first occurrence', () => {
    const first = nextCron('30 1 * * *', Date.UTC(2026, 10, 1, 0), NY)!;
    expect(iso(first)).toBe('2026-11-01T05:30:00.000Z'); // EDT
    expect(iso(nextCron('30 1 * * *', first, NY))).toBe('2026-11-02T06:30:00.000Z'); // next day EST
  });
  it('supports lists, ranges, steps and weekday restriction', () => {
    const mon9 = nextCron('0 9 * * 1', Date.UTC(2026, 9, 26, 12), 'UTC')!; // Monday 12:00 -> next Monday
    expect(iso(mon9)).toBe('2026-11-02T09:00:00.000Z');
    expect(iso(nextCron('*/15 8-9 * * 1-5', Date.UTC(2026, 9, 26, 8, 20), 'UTC'))).toBe(
      '2026-10-26T08:30:00.000Z',
    );
    expect(iso(nextCron('0 0 1,15 * *', Date.UTC(2026, 9, 26), 'UTC'))).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });
  it('is strictly after the reference instant', () => {
    const t = Date.UTC(2026, 9, 26, 9, 0);
    expect(iso(nextCron('0 9 * * *', t, 'UTC'))).toBe('2026-10-27T09:00:00.000Z');
  });
  it('rejects malformed expressions', () => {
    expect(isValidCron('* * * *')).toBe(false);
    expect(isValidCron('61 * * * *')).toBe(false);
    expect(isValidCron('*/0 * * * *')).toBe(false);
    expect(isValidCron('0 21 * * *')).toBe(true);
  });
});

describe('quiet hours', () => {
  const q = { start: '22:00', end: '08:00' };
  it('detects overnight windows in the student time zone', () => {
    expect(inQuietHours(Date.UTC(2026, 9, 27, 3, 0), NY, q)).toBe(true); // 23:00 EDT
    expect(inQuietHours(Date.UTC(2026, 9, 27, 16, 0), NY, q)).toBe(false); // noon
    expect(inQuietHours(Date.UTC(2026, 9, 27, 12, 0), NY, q)).toBe(false); // 08:00 exactly
  });
  it('quietEnd is the next 08:00 local', () => {
    expect(iso(quietEnd(Date.UTC(2026, 9, 27, 3, 0), NY, q))).toBe('2026-10-27T12:00:00.000Z');
    const early = Date.UTC(2026, 9, 27, 8, 0); // 04:00 EDT, same local day
    expect(iso(quietEnd(early, NY, q))).toBe('2026-10-27T12:00:00.000Z');
  });
});
