import { describe, expect, it } from 'vitest';
import type { Ctx, OutboundMessage } from '@squad/core';
import { makeEngine, msg } from '../../quiz/testkit';
import { createQuizSkill, parseAnswer, parseChapter } from './quizSkill';

function setup() {
  const k = makeEngine();
  const dms: { to: string; text: string }[] = [];
  const sent: OutboundMessage[] = [];
  const ctx = {
    db: k.db,
    llm: k.llm,
    send: async (o: OutboundMessage) => void sent.push(o),
    dm: async (to: string, text: string) => void dms.push({ to, text }),
    askConfirm: async () => 'timeout',
  } as unknown as Ctx;
  k.db
    .prepare(
      "INSERT INTO chat_members(chat_id, student_id) VALUES('chat1','s_ana'),('chat1','s_bo')",
    )
    .run();
  const skill = createQuizSkill({ engine: k.engine, courseIdFor: () => 'c' });
  return { ...k, skill, ctx, dms };
}

describe('quiz skill parsing', () => {
  it('parses chapters and answers', () => {
    expect(parseChapter('@cubbie quiz me on chapter 3')).toBe('ch3');
    expect(parseChapter('quiz ch5')).toBe('ch5');
    expect(parseChapter('quiz')).toBeUndefined();
    const p = {
      quizId: 'q',
      chapter: 'c',
      index: 0,
      kind: 'choice' as const,
      question: 'q',
      choices: ['a', 'b', 'c'],
    };
    expect(parseAnswer('b', p)).toEqual({ choice: 1 });
    expect(parseAnswer('3', p)).toEqual({ choice: 2 });
    expect(parseAnswer('D', p)).toBeUndefined();
    expect(parseAnswer('hello', { ...p, kind: 'free' })).toEqual({ text: 'hello' });
  });
});

describe('quiz skill over the shared engine', () => {
  it('starts a quiz and gives identical private feedback to the village path', async () => {
    const t = setup();
    expect(await t.skill.match(msg({ text: '@cubbie quiz ch3' }), t.ctx)).toBeGreaterThanOrEqual(
      0.8,
    );
    const [first] = await t.skill.handle(msg({ text: '@cubbie quiz ch3' }), t.ctx);
    expect(first!.text).toContain('Q1. What does MSE average?');
    expect(first!.text).toContain('B) squared errors');
    expect(first!.text).not.toMatch(/derivative of the square/);

    expect(await t.skill.match(msg({ text: 'B', mentionsBot: false }), t.ctx)).toBeGreaterThan(0.8);
    const out = await t.skill.handle(msg({ text: 'B', mentionsBot: false }), t.ctx);
    // feedback is private (DM); the group gets nothing yet (bo has not answered)
    expect(out).toEqual([]);
    expect(t.dms).toEqual([{ to: 's_ana', text: 'Right. MSE averages squared errors.' }]);

    // village path on a second round with the same questions: same feedback string
    const vid = await t.engine.start('c', 'ch3', 'village', { students: ['s_x'] });
    const v = await t.engine.answer(vid, 's_x', { choice: 1 });
    expect(v.feedback).toBe(t.dms[0]!.text);

    const out2 = await t.skill.handle(msg({ text: 'a', mentionsBot: false, from: 's_bo' }), t.ctx);
    expect(t.dms[1]).toEqual({ to: 's_bo', text: 'Not quite. MSE averages squared errors.' });
    expect(out2[0]!.text).toContain('Q2.'); // everyone answered: next question to the group
  });

  it('plain text free answers in a group need a mention; no scores anywhere', async () => {
    const t = setup();
    await t.skill.handle(msg({ text: 'quiz ch3' }), t.ctx);
    await t.skill.handle(msg({ text: 'b', mentionsBot: false }), t.ctx);
    await t.skill.handle(msg({ text: 'b', mentionsBot: false, from: 's_bo' }), t.ctx);
    expect(
      await t.skill.match(msg({ text: 'because derivative', mentionsBot: false }), t.ctx),
    ).toBe(0);
    expect(
      await t.skill.match(msg({ text: 'because derivative', mentionsBot: true }), t.ctx),
    ).toBeGreaterThan(0.8);
    const all = JSON.stringify(t.dms);
    expect(all).not.toMatch(/score|points|streak|xp/i);
  });
});
