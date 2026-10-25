import { describe, expect, it } from 'vitest';
import {
  MASTERY_REASON,
  MASTERY_WORD,
  chapterNumber,
  getMastery,
  masteryLevel,
  masteryPips,
  masteryWord,
  paintBoard,
  practisePhrase,
  publishMastery,
  sameMastery,
  type MasteryChapter,
} from './mastery';

const ch = (n: number, box: number): MasteryChapter => ({
  slot: `chapter-${n}`,
  instance: `ch${n}`,
  title: `Chapter ${n}`,
  box,
  n,
  open: true,
});

describe('mastery words and pips', () => {
  it('maps every box to one of four plain words', () => {
    expect([0, 1, 2, 3, 4, 5].map(masteryWord)).toEqual([
      'Not started',
      'Learning',
      'Learning',
      'Getting there',
      'Solid',
      'Solid',
    ]);
    expect(Object.values(MASTERY_WORD)).toHaveLength(4);
  });
  it('rounds, clamps and survives junk', () => {
    expect(masteryPips(2.6)).toBe(3);
    expect(masteryPips(99)).toBe(5);
    expect(masteryPips(-3)).toBe(0);
    expect(masteryPips(Number.NaN)).toBe(0);
    expect(masteryLevel(Number.POSITIVE_INFINITY)).toBe('none');
  });
  it('words and reasons never carry a digit (no numeric grades)', () => {
    for (const t of [...Object.values(MASTERY_WORD), ...Object.values(MASTERY_REASON)])
      expect(t).not.toMatch(/\d|%|point|score|level|xp|streak/i);
  });
  it('builds the practise phrase from the chapter number', () => {
    expect(practisePhrase(6, 'x')).toBe('@squad quiz me on chapter 6');
    expect(practisePhrase(undefined, 'Glycolysis')).toBe('@squad quiz me on Glycolysis');
    expect(chapterNumber('ch12')).toBe(12);
    expect(chapterNumber('intro')).toBeUndefined();
  });
});

describe('mastery snapshot and board', () => {
  it('publishes and compares by pips, not fractions', () => {
    publishMastery({ chapters: [ch(1, 2.2)] });
    expect(getMastery().chapters[0]!.title).toBe('Chapter 1');
    expect(sameMastery({ chapters: [ch(1, 2.2)] }, { chapters: [ch(1, 1.9)] })).toBe(true);
    expect(sameMastery({ chapters: [ch(1, 2)] }, { chapters: [ch(1, 3)] })).toBe(false);
  });
  it('the board paints more lit pixels as mastery grows, and is static in calm', () => {
    const lit = (r: ReturnType<typeof paintBoard>) => {
      let n = 0;
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const [a, b, c] = r.get(x, y);
          if (a === 0xff && b === 0xc8 && c === 0x57) n++;
        }
      return n;
    };
    expect(lit(paintBoard([ch(1, 3), ch(2, 5)], 0, true))).toBeGreaterThan(
      lit(paintBoard([ch(1, 0), ch(2, 0)], 0, true)),
    );
    expect(paintBoard([ch(1, 3)], 0, true).hash()).toBe(paintBoard([ch(1, 3)], 9999, true).hash());
  });
});
