import { describe, expect, it } from 'vitest';
import { parseCatalogueCsv, parseCatalogueJson, sampleCatalogue } from './catalogue';
import { parseCsv } from './csv';

const HEAD = 'id,title,credits,prereqs,coreqs,workload,offered,area,days,start,end';

describe('catalogue import', () => {
  it('parses CSV with ; and | separators and quoted fields', () => {
    const csv = [
      HEAD,
      'CSL 101,"Intro, to Programming",3,,,6,fall;spring,core,MWF,09:00,09:50',
      'csl102,Practice,3,CSL 101,,7,fall|spring,core,MWF,09:00,09:50',
      'CSL 201,Org,3,CSL 101;CSL 102,CSL 102,8,fall,core,MWF,09:00,09:50',
    ].join('\r\n');
    const r = parseCatalogueCsv(csv, 'Mine');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.catalogue.sample).toBe(false);
    expect(r.catalogue.courses.map((c) => c.id)).toEqual(['CSL 101', 'CSL 102', 'CSL 201']);
    expect(r.catalogue.courses[0]!.title).toBe('Intro, to Programming');
    expect(r.catalogue.courses[2]).toMatchObject({
      prereqs: ['CSL 101', 'CSL 102'],
      coreqs: ['CSL 102'],
    });
  });
  it('reports row numbers and codes, never values', () => {
    const csv = [
      HEAD,
      'CSL 101,A,3,,,6,fall,core,MWF,09:00,09:50',
      'CSL 102,B,x,,,6,fall,core,MWF,09:00,09:50',
      'CSL 103,C,3,,,6,winter,core,MWF,09:00,09:50',
    ].join('\n');
    const r = parseCatalogueCsv(csv);
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { row: 3, field: 'credits', code: 'invalid_number' },
        expect.objectContaining({ row: 4, field: 'offered' }),
      ]),
    );
    expect(JSON.stringify(r.errors)).not.toMatch(/winter|CSL 10/);
  });
  it('detects unknown prerequisites, duplicates and cycles with rows', () => {
    const base = (rows: string[]) => parseCatalogueCsv([HEAD, ...rows].join('\n'));
    expect(base(['CSL 101,A,3,CSL 999,,6,fall,core,MWF,09:00,09:50'])).toMatchObject({
      ok: false,
      errors: [{ row: 2, code: 'unknown_prereq' }],
    });
    expect(
      base([
        'CSL 101,A,3,,,6,fall,core,MWF,09:00,09:50',
        'CSL 101,B,3,,,6,fall,core,MWF,09:00,09:50',
      ]),
    ).toMatchObject({
      ok: false,
      errors: [{ row: 3, code: 'duplicate_id' }],
    });
    const cyc = base([
      'CSL 101,A,3,CSL 102,,6,fall,core,MWF,09:00,09:50',
      'CSL 102,B,3,CSL 101,,6,fall,core,MWF,09:00,09:50',
    ]);
    expect(cyc).toMatchObject({ ok: false });
    if (!cyc.ok) expect(cyc.errors[0]!.code).toBe('prereq_cycle');
  });
  it('flags a missing header column and an unterminated quote', () => {
    expect(parseCatalogueCsv('id,title\nCSL 101,A')).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: 'missing_column' })]),
    });
    expect(parseCatalogueCsv(`${HEAD}\n"CSL 101,A`)).toMatchObject({
      ok: false,
      errors: [{ code: 'unterminated_quote' }],
    });
    expect(parseCatalogueCsv('')).toMatchObject({ ok: false });
  });
  it('accepts the planner fixture schema as JSON and relabels it as not sample', () => {
    const r = parseCatalogueJson(JSON.stringify(sampleCatalogue()));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.catalogue.sample).toBe(false);
      expect(r.catalogue.courses.length).toBe(sampleCatalogue().courses.length);
    }
    expect(parseCatalogueJson('{')).toMatchObject({
      ok: false,
      errors: [{ code: 'invalid_json' }],
    });
    const bad = parseCatalogueJson(
      JSON.stringify({ name: 'x', sample: false, courses: [{ id: 'nope' }] }),
    );
    expect(bad).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ row: 1 })]),
    });
  });
  it('the sample is labelled', () => {
    expect(sampleCatalogue().sample).toBe(true);
    expect(sampleCatalogue().name).toContain('SAMPLE DATA');
  });
  it('csv reader handles embedded newlines and tracks lines', () => {
    const r = parseCsv('a,b\n"x\ny",2\n\nc,d\n');
    expect(r.rows).toEqual([
      ['a', 'b'],
      ['x\ny', '2'],
      ['c', 'd'],
    ]);
    expect(r.lines).toEqual([1, 2, 5]);
  });
});

describe('catalogue schedule completeness', () => {
  const H = 'id,title,credits,days,start,end';
  it('rejects rows missing days or time by code and row (never blank rows)', () => {
    const r = parseCatalogueCsv([H, 'CSL 101,A,3,,,', 'CSL 102,B,3,MW,09:00,10:15'].join('\n'));
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    const fields = r.errors.filter((e) => e.code === 'missing_days_time').map((e) => e.field);
    expect(fields).toEqual(['days', 'start', 'end']);
    expect(r.errors.every((e) => e.row === 2)).toBe(true);
  });
  it('requires the days/start/end columns', () => {
    const r = parseCatalogueCsv('id,title,credits\nCSL 101,A,3');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok)
      expect(r.errors.map((e) => e.field)).toEqual(
        expect.arrayContaining(['days', 'start', 'end']),
      );
  });
  it('rejects an end that is not after the start', () => {
    expect(parseCatalogueCsv([H, 'CSL 101,A,3,MW,10:00,09:00'].join('\n'))).toMatchObject({
      ok: false,
      errors: [{ row: 2, code: 'missing_days_time' }],
    });
  });
  it('imports the web template (code column, MWF/TR days) with documented defaults', () => {
    const r = parseCatalogueCsv(
      [
        'code,title,credits,days,start,end,location',
        'BIO 201,Cell Biology,4,MWF,9:00,09:50,Science Hall 120',
        'STA 101,Intro Stats,3,TR,13:00,14:15,Online',
      ].join('\n'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.catalogue.courses[0]).toMatchObject({
      id: 'BIO 201',
      days: ['Mon', 'Wed', 'Fri'],
      start: '09:00',
      end: '09:50',
      workload: 12,
      location: 'Science Hall 120',
      offered: ['fall', 'spring', 'summer'],
    });
    expect(r.catalogue.courses[1]!.days).toEqual(['Tue', 'Thu']);
  });
  it('JSON: web shape works, a course without days/time is rejected', () => {
    const ok = parseCatalogueJson(
      JSON.stringify([
        { code: 'BIO 201', title: 'Cell', credits: 4, days: 'MWF', start: '09:00', end: '09:50' },
      ]),
    );
    expect(ok.ok).toBe(true);
    const bad = parseCatalogueJson(
      JSON.stringify([{ code: 'BIO 201', title: 'Cell', credits: 4 }]),
    );
    expect(bad).toMatchObject({ ok: false, errors: [{ row: 1, code: 'missing_days_time' }] });
  });
});
