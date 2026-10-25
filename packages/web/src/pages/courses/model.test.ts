import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  deleteConfirmed,
  deriveCourseStatus,
  masteryWord,
  mergeChapters,
  parseCatalogue,
  precheckFile,
  splitChapter,
  policyLineText,
} from './model';
import { buildCourses } from './fixtures';

const chs = buildCourses(0).find((c) => c.id.startsWith('c_bio'))!.chapters;

describe('courses model', () => {
  it('maps mastery boxes to words', () => {
    expect([0, 1, 2, 3, 4, 5].map(masteryWord)).toEqual([
      'new',
      'learning',
      'learning',
      'steady',
      'steady',
      'strong',
    ]);
  });
  it('prechecks type and size from limits', () => {
    expect(precheckFile({ name: 'a.pdf', size: 10 }, DEFAULT_LIMITS)).toBeNull();
    expect(precheckFile({ name: 'a.pptx', size: 10 }, DEFAULT_LIMITS)?.code).toBe(
      'unsupported_type',
    );
    expect(precheckFile({ name: 'a.pdf', size: 26 * 1024 * 1024 }, DEFAULT_LIMITS)?.code).toBe(
      'too_large',
    );
  });
  it('derives course status from files', () => {
    expect(deriveCourseStatus([])).toBe('empty');
    expect(deriveCourseStatus([{ status: 'ready' }, { status: 'parsing' }])).toBe('ingesting');
    expect(deriveCourseStatus([{ status: 'failed' }])).toBe('failed');
    expect(deriveCourseStatus([{ status: 'ready' }, { status: 'failed' }])).toBe('ready');
  });
  it('splits and merges chapters', () => {
    const first = chs[0]!;
    const split = splitChapter(chs, { chapter: first.id, atPage: 20, title: 'Part 2' }, 'new1');
    expect(split.length).toBe(chs.length + 1);
    expect(split[0]!.pageEnd).toBe(19);
    expect(split[1]).toMatchObject({ id: 'new1', pageStart: 20, pageEnd: first.pageEnd });
    const back = mergeChapters(split, { from: 'new1', into: first.id });
    expect(back[0]!.pageEnd).toBe(first.pageEnd);
    expect(back.length).toBe(chs.length);
    expect(splitChapter(chs, { chapter: first.id, atPage: first.pageStart, title: 'x' }, 'n')).toBe(
      chs,
    );
  });
  it('keeps policy text verbatim', () => {
    const t = '  Late work   loses 10%.  ';
    expect(policyLineText({ n: 1, text: t, verbatim: true, topic: 'homework' })).toBe(t);
  });
  it('gates delete on the typed title', () => {
    expect(deleteConfirmed('bio', 'BIO 201', false)).toBe(false);
    expect(deleteConfirmed('BIO 201', 'BIO 201', false)).toBe(true);
  });
  it('reports catalogue row numbers', () => {
    const r = parseCatalogue(
      'code,title,credits,days,start,end\nA 1,Ok,3,MWF,09:00,09:50\n,Bad,x,MWF,10:00,09:00',
      'a.csv',
    );
    expect(r.rows.length).toBe(1);
    expect(r.issues.every((i) => i.row === 2)).toBe(true);
    expect(r.issues.length).toBeGreaterThan(1);
  });
});
