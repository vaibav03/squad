import { describe, expect, it } from 'vitest';
import { catalogueRowFrom, catalogueRowGap } from './model';

describe('hub catalogue rows -> web rows', () => {
  it('maps id/days[]/offered to code/MWF/term (the old mapping rendered blanks)', () => {
    const r = catalogueRowFrom({
      id: 'CSL 240',
      title: 'Data Structures',
      credits: 3,
      prereqs: ['CSL 102'],
      offered: ['fall', 'spring'],
      days: ['Mon', 'Wed', 'Fri'],
      start: '09:00',
      end: '09:50',
    });
    expect(r).toMatchObject({
      code: 'CSL 240',
      days: 'MWF',
      start: '09:00',
      end: '09:50',
      prereqs: ['CSL 102'],
      term: 'fall, spring',
    });
    expect(catalogueRowGap(r)).toBeNull();
  });
  it('Thursday is R; a row without days/time is flagged, not blank', () => {
    expect(catalogueRowFrom({ id: 'A 1', days: ['Tue', 'Thu'] }).days).toBe('TR');
    const r = catalogueRowFrom({ id: 'CSL 101', title: 'Intro', credits: 3 });
    expect(catalogueRowGap(r)).toBe('Missing days/time');
  });
});
