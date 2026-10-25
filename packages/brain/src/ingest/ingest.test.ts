import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { quoteOnPage } from '../citations';
import {
  FIXTURE_DIR,
  chapterIdFromFile,
  cleanPageText,
  createCourseStore,
  detectSections,
  extractPolicy,
  ingestText,
  loadFixtureCourse,
} from './index';

const mk = () => {
  const store = createCourseStore(openMemoryDb());
  return { store };
};

describe('store + ingestText', () => {
  it('round-trips pages, chapters and a byte-stable chapter context', async () => {
    const deps = mk();
    const n = await ingestText(deps, 'c1', 'ch3-slides.pdf', [
      'Alpha beta gamma delta epsilon.',
      'Second page text here now.',
    ]);
    expect(n).toBe(2);
    const ch = deps.store.getChapter('c1', 'ch3');
    expect(ch).toMatchObject({ file: 'ch3-slides.pdf', pageStart: 1, pageEnd: 2 });
    expect(deps.store.getPage('c1', 'ch3-slides.pdf', 2)?.text).toContain('Second page');
    const ctx = deps.store.chapterContext('c1', 'ch3');
    expect(ctx).toBe(
      '[ch3-slides.pdf p.1]\nAlpha beta gamma delta epsilon.\n\n[ch3-slides.pdf p.2]\nSecond page text here now.',
    );
    expect(deps.store.chapterContext('c1', 'ch3')).toBe(ctx);
  });

  it('re-ingest replaces pages instead of duplicating', async () => {
    const deps = mk();
    await ingestText(deps, 'c1', 'ch1.pdf', ['one one one one one.', 'two two two two two.']);
    await ingestText(deps, 'c1', 'ch1.pdf', ['only page now here ok.']);
    expect(deps.store.getPages('c1', 'ch1')).toHaveLength(1);
    expect(deps.store.listChapters('c1')).toHaveLength(1);
  });

  it('splits one big PDF by Chapter headings', async () => {
    const deps = mk();
    const pages = [
      'Chapter 1 Sampling and Data\nbody',
      'more',
      'Chapter 2 Descriptive Statistics\nbody',
      'x',
    ];
    expect(detectSections(pages).map((s) => s.id)).toEqual(['ch1', 'ch2']);
    await ingestText(deps, 'c', 'book.pdf', pages, { splitByHeadings: true });
    expect(deps.store.listChapters('c').map((c) => [c.id, c.pageStart, c.pageEnd])).toEqual([
      ['ch1', 1, 2],
      ['ch2', 3, 4],
    ]);
    expect(deps.store.getPages('c', 'ch2').map((p) => p.page)).toEqual([3, 4]);
  });

  it('summaries: FakeLlm summary used; falls back to extractive when the llm fails', async () => {
    const llm = new FakeLlm({ responses: [{ summary: 'Topics: mean, median, spread.' }] });
    const a = mk();
    await ingestText({ ...a, llm }, 'c', 'ch2.pdf', ['Mean is the average of values in a set.']);
    expect(a.store.getChapter('c', 'ch2')?.summary).toBe('Topics: mean, median, spread.');
    const b = mk();
    await ingestText({ ...b, llm: new FakeLlm() }, 'c', 'ch2.pdf', [
      'Mean is the average of values in a set.',
    ]);
    expect(b.store.getChapter('c', 'ch2')?.summary).toContain('Mean is the average');
  });

  it('helpers', () => {
    expect(chapterIdFromFile('ch12-linear-regression.pdf')).toBe('ch12');
    expect(chapterIdFromFile('Lecture Notes.pdf')).toBe('lecture-notes');
    expect(cleanPageText('exam-\nple  text\r\n\n\n\nnext')).toBe('example text\n\nnext');
    expect(extractPolicy('Hello\nHomework is graded.\nOffice hours')).toBe('Homework is graded.');
  });
});

describe('OpenStax fixture course', () => {
  it('loads offline with 4 chapters, pages, summaries and the syllabus policy', async () => {
    const deps = mk();
    const course = await loadFixtureCourse(deps);
    expect(course.chapters.map((c) => c.id)).toEqual(['ch2', 'ch3', 'ch6', 'ch12']);
    for (const c of course.chapters) {
      expect(c.pageEnd - c.pageStart + 1).toBeGreaterThanOrEqual(12);
      expect(c.summary.length).toBeGreaterThan(20);
    }
    expect(course.policy).toMatch(/not allowed/);
    expect(deps.store.getPages('demo').length).toBe(50);
  });

  it('every golden quote is on its stated page (after normalisation)', async () => {
    const deps = mk();
    await loadFixtureCourse(deps);
    const g = JSON.parse(readFileSync(join(FIXTURE_DIR, 'golden.json'), 'utf8')) as {
      answerable: { chapter: string; file: string; page: number; quote: string }[];
      unanswerable: { question: string }[];
    };
    expect(g.answerable.length).toBeGreaterThanOrEqual(12);
    expect(g.unanswerable.length).toBeGreaterThanOrEqual(6);
    for (const q of g.answerable) {
      const pg = deps.store.getPage('demo', q.file, q.page);
      expect(pg, q.quote).toBeTruthy();
      expect(pg!.chapter).toBe(q.chapter);
      expect(quoteOnPage(q.quote, pg!.text), q.quote).toBe(true);
    }
  });
});
