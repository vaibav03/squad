import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Chapter, Page } from '../ingest/types';
import {
  checkModel,
  mergeChapters,
  renameChapter,
  splitChapter,
  uniqueChapterId,
  type CourseModel,
} from './chapterops';
import { LibraryError } from './types';

function model(n: number, file = 'a.pdf'): CourseModel {
  const pages: Page[] = Array.from({ length: n }, (_, i) => ({
    courseId: 'c',
    chapter: 'main',
    file,
    page: i + 1,
    text: `Page ${i + 1} explains the topic number ${i + 1} in some detail.`,
  }));
  const chapters: Chapter[] = [
    { courseId: 'c', id: 'main', title: 'Main', summary: 's', file, pageStart: 1, pageEnd: n },
  ];
  return { chapters, pages };
}
const key = (m: CourseModel) =>
  m.pages
    .map((p) => `${p.file}:${p.page}:${p.text}`)
    .sort()
    .join('|');
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof LibraryError ? e.code : 'other';
  }
};

describe('chapter ops', () => {
  it('splits at a page, keeps ranges and summaries consistent', () => {
    const { model: m, created } = splitChapter(model(10), 'main', 4, 'Second part');
    expect(created).toBe('second-part');
    expect(m.chapters.map((c) => [c.id, c.pageStart, c.pageEnd])).toEqual([
      ['main', 1, 3],
      ['second-part', 4, 10],
    ]);
    expect(m.chapters[1]!.summary).toContain('Page 4');
    expect(checkModel(m)).toEqual([]);
  });
  it('rejects bad split points and titles', () => {
    expect(code(() => splitChapter(model(5), 'main', 1, 'x'))).toBe('invalid_split_point');
    expect(code(() => splitChapter(model(5), 'main', 9, 'x'))).toBe('invalid_split_point');
    expect(code(() => splitChapter(model(5), 'nope', 2, 'x'))).toBe('chapter_not_found');
    expect(code(() => splitChapter(model(5), 'main', 2, '   '))).toBe('invalid_title');
  });
  it('makes ids unique and valid for expert:<id>', () => {
    expect(uniqueChapterId('Ch 3: Probability!', [])).toBe('ch-3-probability');
    expect(uniqueChapterId('!!!', [])).toBe('chapter');
    expect(uniqueChapterId('Main', ['main', 'main-2'])).toBe('main-3');
    const a = splitChapter(model(6), 'main', 3, 'Main');
    expect(a.created).toBe('main-2');
  });
  it('merges neighbours in one file and refuses the rest', () => {
    const { model: m } = splitChapter(model(9), 'main', 4, 'B');
    const { model: m3 } = splitChapter(m, 'b', 7, 'C');
    expect(code(() => mergeChapters(m3, 'main', 'c'))).toBe('chapters_not_adjacent');
    expect(code(() => mergeChapters(m3, 'b', 'b'))).toBe('invalid_merge');
    const merged = mergeChapters(m3, 'c', 'b');
    expect(merged.chapters.map((c) => [c.id, c.pageStart, c.pageEnd])).toEqual([
      ['main', 1, 3],
      ['b', 4, 9],
    ]);
    expect(checkModel(merged)).toEqual([]);
    const other = {
      chapters: [
        ...m.chapters,
        { ...m.chapters[0]!, id: 'z', file: 'z.pdf', pageStart: 1, pageEnd: 1 },
      ],
      pages: [...m.pages, { ...m.pages[0]!, chapter: 'z', file: 'z.pdf', page: 1 }],
    };
    expect(code(() => mergeChapters(other, 'z', 'b'))).toBe('chapters_in_different_files');
  });
  it('renames without touching pages', () => {
    const m = renameChapter(model(3), 'main', '  New   name ');
    expect(m.chapters[0]!.title).toBe('New name');
    expect(m.pages).toEqual(model(3).pages);
  });

  it('property: any split/merge sequence never loses or duplicates a page', () => {
    const op = fc.record({
      kind: fc.constantFrom('split', 'merge', 'rename'),
      a: fc.nat(30),
      b: fc.nat(30),
      title: fc.string({ minLength: 1, maxLength: 12 }),
    });
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 25 }), fc.array(op, { maxLength: 25 }), (n, ops) => {
        let m = model(n);
        const before = key(m);
        for (const o of ops) {
          try {
            if (o.kind === 'split') {
              const ch = m.chapters[o.a % m.chapters.length]!;
              m = splitChapter(
                m,
                ch.id,
                ch.pageStart + 1 + (o.b % Math.max(1, ch.pageEnd - ch.pageStart)),
                o.title || 'x',
              ).model;
            } else if (o.kind === 'merge') {
              const i = o.a % m.chapters.length;
              const j = (i + 1) % m.chapters.length;
              m = mergeChapters(m, m.chapters[i]!.id, m.chapters[j]!.id);
            } else m = renameChapter(m, m.chapters[o.a % m.chapters.length]!.id, o.title || 'x');
          } catch (e) {
            if (!(e instanceof LibraryError)) throw e;
          }
          expect(checkModel(m)).toEqual([]);
        }
        expect(key(m)).toBe(before);
        expect(m.pages).toHaveLength(n);
      }),
      { numRuns: 200 },
    );
  });
});
