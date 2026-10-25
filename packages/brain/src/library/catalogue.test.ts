import { describe, expect, it } from 'vitest';
import { parseCatalogueCsv, parseCatalogueJson, sampleCatalogue } from './catalogue';
import { parseCsv } from './csv';

const HEAD = 'id,title,credits,prereqs,coreqs,workload,offered,area';

describe('catalogue import', () => {
  it('parses CSV with ; and | separators and quoted fields', () => {
    const csv = [
      HEAD,
      'CSL 101,"Intro, to Programming",3,,,6,fall;spring,core',
      'csl102,Practice,3,CSL 101,,7,fall|spring,core',
      'CSL 201,Org,3,CSL 101;CSL 102,CSL 102,8,fall,core',
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
      'CSL 101,A,3,,,6,fall,core',
      'CSL 102,B,x,,,6,fall,core',
      'CSL 103,C,3,,,6,winter,core',
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
    expect(base(['CSL 101,A,3,CSL 999,,6,fall,core'])).toMatchObject({
      ok: false,
      errors: [{ row: 2, code: 'unknown_prereq' }],
    });
    expect(base(['CSL 101,A,3,,,6,fall,core', 'CSL 101,B,3,,,6,fall,core'])).toMatchObject({
      ok: false,
      errors: [{ row: 3, code: 'duplicate_id' }],
    });
    const cyc = base(['CSL 101,A,3,CSL 102,,6,fall,core', 'CSL 102,B,3,CSL 101,,6,fall,core']);
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
