import { describe, expect, it } from 'vitest';
import { examWeights, isExamChapter, rankChapters, titleKeywords } from './rank';

const DAY = 86_400_000;
const NOW = 10 * DAY;
const chs = [
  { id: 'ch1', title: 'Descriptive Statistics' },
  { id: 'ch2', title: 'Probability Basics' },
  { id: 'ch3', title: 'The Normal Distribution' },
];
const row = (chapter: string, box: number, nextDue: number) => ({ chapter, box, nextDue });

describe('rankChapters', () => {
  it('ranks a due box-1 chapter above a not-due box-5 chapter', () => {
    const r = rankChapters(chs, [row('ch1', 5, NOW + DAY), row('ch2', 1, NOW)], {}, NOW);
    expect(r.map((x) => x.chapter)).toEqual(['ch2', 'ch3', 'ch1']);
    expect(r[1]!.practised).toBe(false);
  });
  it('exam weight lifts a chapter', () => {
    const rows = chs.map((c) => row(c.id, 3, NOW + DAY));
    expect(rankChapters(chs, rows, {}, NOW).map((x) => x.chapter)).toEqual(['ch1', 'ch2', 'ch3']);
    expect(rankChapters(chs, rows, { ch3: 1 }, NOW).map((x) => x.chapter)[0]).toBe('ch3');
  });
  it('ties break by chapter order and the result is deterministic', () => {
    const a = rankChapters(chs, [], {}, NOW);
    expect(a.map((x) => x.chapter)).toEqual(['ch1', 'ch2', 'ch3']);
    expect(rankChapters(chs, [], {}, NOW)).toEqual(a);
  });
});

describe('examWeights', () => {
  it('counts keywords and explicit chapter mentions, normalised to 0..1', () => {
    const w = examWeights(chs, [
      'Q1. Compute the normal distribution tail. Q2. Normal approximation (Chapter 3). Q3 see ch3.',
      'Q4. Find the median.',
    ]);
    expect(w.ch3).toBe(1);
    expect(w.ch1).toBe(0);
    expect(Object.values(w).every((v) => v >= 0 && v <= 1)).toBe(true);
  });
  it('is all zero without exam text', () => {
    expect(Object.values(examWeights(chs, []))).toEqual([0, 0, 0]);
  });
  it('keywords drop stop-words and short words', () => {
    expect(titleKeywords('The Normal Distribution of Data')).toEqual([
      'normal',
      'distribution',
      'data',
    ]);
  });
  it('flags exam-looking chapters', () => {
    expect(isExamChapter({ id: 'x', file: 'midterm-2023.pdf' })).toBe(true);
    expect(isExamChapter({ id: 'ch1', file: 'ch1.pdf' })).toBe(false);
  });
});
