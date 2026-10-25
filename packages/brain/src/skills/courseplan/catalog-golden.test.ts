import { describe, expect, it } from 'vitest';
import { loadCatalog, meetingOf, missingSchedule, scheduleLabel, timesOverlap } from './index';

/** Golden: the committed sample catalogue is complete, so no UI row can render blank. */
describe('golden sample catalogue', () => {
  const { catalog } = loadCatalog();
  it('has 39 complete rows: code, title, credits, days, start/end, prerequisites, term', () => {
    expect(catalog.courses).toHaveLength(39);
    for (const c of catalog.courses) {
      expect(c.id).toMatch(/^[A-Z]{3} \d{3}$/);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.credits).toBeGreaterThan(0);
      expect(Array.isArray(c.prereqs)).toBe(true);
      expect(c.offered.length).toBeGreaterThan(0);
      expect(meetingOf(c), c.id).not.toBeNull();
      expect(missingSchedule(c), c.id).toBeNull();
    }
  });
  it('pins exact meetings for a few rows', () => {
    const by = (id: string) => catalog.courses.find((c) => c.id === id)!;
    expect(scheduleLabel(by('CSL 101'))).toBe('Tue/Thu 13:00-14:15');
    expect(scheduleLabel(by('CSL 102'))).toBe('Mon/Wed/Fri 08:00-08:50');
    expect(scheduleLabel(by('CSL 110'))).toBe('Mon/Wed 14:30-15:45');
  });
  it('courses of the same year never share a meeting slot', () => {
    for (const a of catalog.courses)
      for (const b of catalog.courses)
        if (a.id < b.id && a.id[4] === b.id[4])
          expect(timesOverlap(a, b), `${a.id} ${b.id}`).toBe(false);
  });
  it('flags an incomplete row instead of rendering blanks', () => {
    const { days: _d, ...rest } = catalog.courses[0]!;
    expect(missingSchedule(rest)).toBe('Missing days/time');
    expect(scheduleLabel(rest)).toBe('Missing days/time');
  });
});
