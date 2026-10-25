import { describe, expect, it, vi } from 'vitest';
import { createTestBot } from './testing';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('askConfirm', () => {
  it('DMs numbered options and resolves with the option for a number or text', async () => {
    const t = createTestBot();
    const p = t.bot.ctx.askConfirm('s_ana', 'Book Friday?', ['Yes, book it', 'No thanks'], 'task1');
    await tick();
    expect(t.sent[0]!.chatId).toBe('dm:s_ana');
    expect(t.sent[0]!.text).toContain('1. Yes, book it');
    expect(t.sent[0]!.text).toContain('Reply 1 or 2.');
    const r = await t.answerConfirm('s_ana', '2');
    expect(r.decision.reason).toBe('confirm_reply');
    expect(await p).toBe('No thanks');
    const p2 = t.bot.ctx.askConfirm('s_ana', 'Again?', ['Yes', 'No'], 'task2');
    await tick();
    await t.answerConfirm('s_ana', 'YES');
    expect(await p2).toBe('Yes');
  });

  it('cancel drops a pending card and a queued one; the next card then starts', async () => {
    const t = createTestBot();
    const first = t.bot.ctx.askConfirm('s_ana', 'One?', ['a', 'b'], 'A');
    const second = t.bot.ctx.askConfirm('s_ana', 'Two?', ['c', 'd'], 'B');
    const third = t.bot.ctx.askConfirm('s_ana', 'Three?', ['e', 'f'], 'C');
    await tick();
    expect(t.bot.confirms.cancel('s_ana', 'B')).toBe(true); // queued
    expect(t.bot.confirms.cancel('s_ana', 'A')).toBe(true); // active
    expect(t.bot.confirms.cancel('s_ana', 'nope')).toBe(false);
    expect(await first).toBe('timeout');
    expect(await second).toBe('timeout');
    await tick();
    expect(t.sent.at(-1)!.text).toContain('Three?');
    await t.answerConfirm('s_ana', '2');
    expect(await third).toBe('f');
  });

  it('emits agent.state + confirm.pending before the DM, confirm.done after, with taskId', async () => {
    const t = createTestBot();
    const p = t.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T9');
    await tick();
    await t.answerConfirm('s_ana', '1');
    await p;
    const kinds = t.events.map((e) => e.t + ('state' in e ? `:${e.state}` : ''));
    expect(kinds).toEqual([
      'agent.state:waiting_for_student',
      'confirm.pending',
      'confirm.done',
      'agent.state:idle',
    ]);
    expect(
      t.events
        .filter((e) => e.t.startsWith('confirm'))
        .every((e) => 'taskId' in e && e.taskId === 'T9'),
    ).toBe(true);
  });

  it('wrong text gets one reprompt, then the right text resolves; DMs never reach skills meanwhile', async () => {
    const handle = vi.fn(async () => []);
    const t = createTestBot({ skills: [{ name: 'spy', match: async () => 1, handle }] });
    const p = t.bot.ctx.askConfirm('s_ana', 'Q?', ['red', 'blue'], 'T');
    await tick();
    await t.answerConfirm('s_ana', 'purple');
    await t.answerConfirm('s_ana', 'purple again');
    expect(t.sent.filter((s) => s.text?.includes('did not catch'))).toHaveLength(1);
    await t.answerConfirm('s_ana', 'blue');
    expect(await p).toBe('blue');
    expect(handle).not.toHaveBeenCalled();
  });

  it('times out exactly once with the injected timeout', async () => {
    vi.useFakeTimers();
    try {
      const t = createTestBot({ confirmTimeoutMs: 1000 });
      const p = t.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T');
      await vi.advanceTimersByTimeAsync(1001);
      expect(await p).toBe('timeout');
      expect(t.events.filter((e) => e.t === 'confirm.done')).toHaveLength(1);
      expect(t.bot.confirms.hasPending('s_ana')).toBe(false);
      // a late reply goes to the router, not a ghost confirm
      const r = await t.answerConfirm('s_ana', '1');
      expect(r.decision.reason).toBe('dm');
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues FIFO per student and never cross-resolves between students', async () => {
    const t = createTestBot();
    const a1 = t.bot.ctx.askConfirm('s_ana', 'Q1', ['a', 'b'], 'T1');
    const a2 = t.bot.ctx.askConfirm('s_ana', 'Q2', ['c', 'd'], 'T2');
    const b1 = t.bot.ctx.askConfirm('s_ben', 'Q3', ['e', 'f'], 'T3');
    await tick();
    expect(t.sent.map((s) => s.chatId)).toEqual(['dm:s_ana', 'dm:s_ben']);
    await t.answerConfirm('s_ben', '2');
    expect(await b1).toBe('f');
    await t.answerConfirm('s_ana', '1');
    expect(await a1).toBe('a');
    await tick();
    expect(t.sent.at(-1)!.text).toContain('Q2');
    await t.answerConfirm('s_ana', '2');
    expect(await a2).toBe('d');
  });

  it('group messages are never consumed; duplicate taskId rejects; persisted rows', async () => {
    const t = createTestBot();
    const p = t.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T');
    await tick();
    const g = await t.say('s_ana', 'group:test', '1');
    expect(g.decision.reason).not.toBe('confirm_reply');
    await expect(t.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T')).rejects.toThrow(/duplicate/);
    expect(
      t.db.prepare('SELECT COUNT(*) c FROM pending_confirms WHERE answer IS NULL').get(),
    ).toEqual({ c: 1 });
    await t.answerConfirm('s_ana', '1');
    await p;
    expect(t.db.prepare('SELECT answer FROM pending_confirms').get()).toEqual({ answer: 'a' });
  });

  it('a failing DM rejects, cleans up and does not wedge the queue', async () => {
    const t = createTestBot();
    t.transport.failNext = 1;
    await expect(t.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T')).rejects.toThrow();
    expect(t.bot.confirms.hasPending('s_ana')).toBe(false);
    const p = t.bot.ctx.askConfirm('s_ana', 'Q?', ['a', 'b'], 'T');
    await tick();
    await t.answerConfirm('s_ana', '1');
    expect(await p).toBe('a');
  });
});
