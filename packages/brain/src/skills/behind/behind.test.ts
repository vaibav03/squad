import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Db } from '@squad/core';
import { makeSkillKit, msg } from '../testkit';
import { GROUP_PUBLIC_TEXT, NO_DATA_TEXT, buildSummary, createBehindSkill } from './index';

const NOW = 10 * 86_400_000;
const seed = (db: Db, rows: [string, string, number, number][]) => {
  db.exec(
    `CREATE TABLE IF NOT EXISTS mastery(student TEXT, courseId TEXT, chapter TEXT, box INTEGER, nextDue INTEGER, updatedAt INTEGER DEFAULT 0, PRIMARY KEY(student, courseId, chapter))`,
  );
  const ins = db.prepare(
    'INSERT INTO mastery(student, courseId, chapter, box, nextDue) VALUES(?,?,?,?,?)',
  );
  for (const [s, ch, box, due] of rows) ins.run(s, 'demo', ch, box, due);
};

describe('behindSkill', () => {
  it('in a group: DM with own summary, group only sees "Sent you a DM."', async () => {
    const k = await makeSkillKit();
    seed(k.db, [
      ['s_ana', 'ch2', 1, NOW - 3 * 86_400_000],
      ['s_ana', 'ch6', 4, NOW + 86_400_000],
      ['s_bo', 'ch2', 5, NOW + 1],
    ]);
    const out = await createBehindSkill(k.brain, { now: () => NOW }).handle(
      msg('@cubbie am I behind?'),
      k.ctx,
    );
    expect(out).toEqual([{ chatId: 'group:t', text: GROUP_PUBLIC_TEXT }]);
    expect(k.dms).toHaveLength(1);
    expect(k.dms[0]!.to).toBe('s_ana');
    const t = k.dms[0]!.text;
    expect(t).toContain('Descriptive Statistics (box 1 of 5)');
    expect(t).toMatch(/Overdue for review: Descriptive Statistics \(oldest by 3 days\)/);
    expect(t).toContain('Next step: take a quiz in Descriptive Statistics.');
    expect(k.sent).toHaveLength(0);
  });

  it('in a DM the summary is the reply, nothing goes to a group', async () => {
    const k = await makeSkillKit();
    seed(k.db, [['s_ana', 'ch6', 2, NOW - 1]]);
    const out = await createBehindSkill(k.brain, { now: () => NOW }).handle(
      msg('am i behind', { isGroup: false, chatId: 'dm:ana' }),
      k.ctx,
    );
    expect(out[0]!.text).toContain('The Normal Distribution (box 2 of 5)');
    expect(out[0]!.text).toContain('Not started yet: Descriptive Statistics');
    expect(k.dms).toHaveLength(0);
  });

  it('no rows or no table: says there is no data yet', async () => {
    const k = await makeSkillKit();
    await createBehindSkill(k.brain).handle(msg('@cubbie am I behind?'), k.ctx);
    expect(k.dms[0]!.text).toBe(NO_DATA_TEXT);
  });

  it('never includes other students or aggregates (property)', async () => {
    const chapters = [
      {
        courseId: 'demo',
        id: 'ch2',
        title: 'Alpha',
        summary: '',
        file: 'a',
        pageStart: 1,
        pageEnd: 1,
      },
      {
        courseId: 'demo',
        id: 'ch6',
        title: 'Beta',
        summary: '',
        file: 'b',
        pageStart: 1,
        pageEnd: 1,
      },
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            chapter: fc.constantFrom('ch2', 'ch6'),
            box: fc.integer({ min: 1, max: 5 }),
            nextDue: fc.integer({ min: 0, max: 2 * NOW }),
          }),
          { maxLength: 2 },
        ),
        (rows) => {
          const uniq = [...new Map(rows.map((r) => [r.chapter, r])).values()];
          const s = buildSummary(chapters, uniq, NOW) ?? '';
          expect(s).not.toMatch(/s_bo|everyone|average|squad|classmates|others|\bavg\b|ranked|%/i);
        },
      ),
    );
  });

  it('only reads the asker rows (SQL scoped by student)', async () => {
    const k = await makeSkillKit();
    seed(k.db, [
      ['s_bo', 'ch2', 1, 0],
      ['s_cy', 'ch6', 1, 0],
    ]);
    await createBehindSkill(k.brain).handle(msg('@cubbie am I behind?'), k.ctx);
    expect(k.dms[0]!.text).toBe(NO_DATA_TEXT);
  });

  it.each([
    ['@cubbie am I behind?', true, 0.95],
    ['how am i doing', false, 0.3],
    ['why is the sky blue', true, 0],
  ])('match(%j)', async (text, mentionsBot, want) => {
    const k = await makeSkillKit();
    expect(await createBehindSkill(k.brain).match(msg(text, { mentionsBot }), k.ctx)).toBe(want);
  });
});
