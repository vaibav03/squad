import { describe, expect, it } from 'vitest';
import { parseIcs, parseIcsDate } from './ics';
import {
  completedSteps,
  formatPhone,
  initialState,
  reducer,
  validateCode,
  validateFile,
  validatePhone,
} from './model';

const ics = (body: string) => `BEGIN:VCALENDAR\r\n${body}\r\nEND:VCALENDAR`;
const ev = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;

describe('ics parser', () => {
  it('reads UTC events and never exposes titles', () => {
    const out = parseIcs(
      ics(ev(['SUMMARY:Secret therapy', 'DTSTART:20261026T150000Z', 'DTEND:20261026T160000Z'])),
    );
    expect(out).toEqual([{ start: '2026-10-26T15:00:00.000Z', end: '2026-10-26T16:00:00.000Z' }]);
    expect(JSON.stringify(out)).not.toContain('therapy');
  });
  it('handles TZID params, folded lines, floating times', () => {
    const out = parseIcs(
      ics(
        ev([
          'DTSTART;TZID=America/Phoenix:20261026T090000',
          'DTEND;TZID=America/Phoenix:2026102\r\n 6T100000',
        ]),
      ),
    );
    expect(out).toHaveLength(1);
  });
  it('skips all-day, free, cancelled, reversed and malformed events', () => {
    const body = [
      ev(['DTSTART;VALUE=DATE:20261026', 'DTEND;VALUE=DATE:20261027']),
      ev(['DTSTART:20261026T150000Z', 'DTEND:20261026T160000Z', 'TRANSP:TRANSPARENT']),
      ev(['DTSTART:20261026T150000Z', 'DTEND:20261026T160000Z', 'STATUS:CANCELLED']),
      ev(['DTSTART:20261026T160000Z', 'DTEND:20261026T150000Z']),
      ev(['DTSTART:garbage', 'DTEND:20261026T150000Z']),
    ].join('\r\n');
    expect(parseIcs(ics(body))).toEqual([]);
  });
  it('returns [] for non-calendar text', () => {
    expect(parseIcs('hello')).toEqual([]);
    expect(parseIcsDate('2026-10-26')).toBeNull();
  });
});

describe('setup model', () => {
  it('formats and validates phones', () => {
    expect(formatPhone('5550100101')).toBe('(555) 010-0101');
    expect(formatPhone('+1 555 010 0101')).toBe('(555) 010-0101');
    expect(validatePhone('')).toMatch(/Enter/);
    expect(validatePhone('555')).toMatch(/short/);
    expect(validatePhone('(555) 010-0101')).toBeNull();
  });
  it('validates codes with the demo failure code', () => {
    expect(validateCode('12')).toMatch(/6/);
    expect(validateCode('000000')).toMatch(/did not match/);
    expect(validateCode('123456')).toBeNull();
  });
  it('validates files', () => {
    expect(validateFile({ name: 'a.pdf', size: 10, type: 'application/pdf' })).toBeNull();
    expect(validateFile({ name: 'a.png', size: 10, type: 'image/png' })).toMatch(/not a PDF/);
    expect(
      validateFile({ name: 'big.pdf', size: 60 * 1024 * 1024, type: 'application/pdf' }),
    ).toMatch(/50 MB/);
  });
  it('reducer drives completion', () => {
    let s = reducer(initialState, { type: 'phone/verified' });
    s = reducer(s, {
      type: 'courses/add',
      files: [{ id: 'x', name: 'a.pdf', size: 1, status: 'queued', progress: 0 }],
    });
    expect(completedSteps(s)).toEqual(['phone']);
    s = reducer(s, { type: 'courses/progress', id: 'x', progress: 1 });
    s = reducer(s, { type: 'persona/pick', id: 'owl' });
    expect(completedSteps(s)).toEqual(['phone', 'courses', 'persona']);
    s = reducer(s, { type: 'courses/progress', id: 'x', progress: 0.2 });
    expect(s.courses[0]!.progress).toBe(1);
  });
});

describe('postCalendar ics upload', () => {
  it('sends the file as multipart with an .ics name', async () => {
    const { postCalendar } = await import('./api');
    let seen: RequestInit | undefined;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ busyBlocks: 2 }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await postCalendar(
        { hubUrl: 'http://h', token: 't' },
        { ics: 'BEGIN:VCALENDAR', name: 'mine.ics' },
      );
      expect(r.busyBlocks).toBe(2);
      expect(seen?.body).toBeInstanceOf(FormData);
      const f = (seen?.body as FormData).get('file') as File;
      expect(f.name).toBe('mine.ics');
    } finally {
      globalThis.fetch = orig;
    }
  });
});
