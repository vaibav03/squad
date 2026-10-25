import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@squad/core';
import { collapseRepeatedPairs, COLLAPSE_WINDOW_MS } from './dedupe';

let n = 0;
const msg = (
  kind: 'student' | 'persona',
  text: string,
  ts: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage => {
  n += 1;
  return {
    id: `m_${n}`,
    seq: n,
    chatId: 'group:g',
    ts,
    sender:
      kind === 'student'
        ? { kind, id: 's_ana', name: 'Ana' }
        : { kind, id: 'cubbie', name: 'Cubbie' },
    text,
    private: false,
    attachments: [],
    citations: [],
    demo: false,
    ...extra,
  };
};

describe('collapseRepeatedPairs', () => {
  it('keeps the first pair with a repeat count', () => {
    const out = collapseRepeatedPairs([
      msg('student', '@cubbie plan', 1000),
      msg('persona', 'plan A', 1100),
      msg('student', '@cubbie plan', 2000),
      msg('persona', 'plan A', 2100),
    ]);
    expect(out.map((m) => m.text)).toEqual(['@cubbie plan', 'plan A']);
    expect(out[0]!.repeat).toBe(2);
  });
  it('collapses repeated quiz prompts whose cards differ only by ids, and folds unanswered copies', () => {
    const quiz = (qid: string) =>
      ({ type: 'quiz', index: 0, question: 'What is a z-score?', input: 'free', _id: qid }) as never;
    const out = collapseRepeatedPairs([
      msg('student', '@cubbie quiz me', 1000),
      msg('student', '@cubbie quiz me', 1500),
      msg('student', '@cubbie quiz me', 2000),
      msg('persona', 'Q1', 2100, { card: quiz('a') }),
      msg('student', '@cubbie quiz me', 3_600_000),
      msg('persona', 'Q1', 3_600_100, { card: quiz('b') }),
    ]);
    expect(out.map((m) => m.text)).toEqual(['@cubbie quiz me', 'Q1']);
    expect(out[0]!.repeat).toBe(4);
  });
  it('never merges different answers, unanswered prompts, or pairs beyond the window', () => {
    const out = collapseRepeatedPairs([
      msg('student', 'q', 1000),
      msg('persona', 'a1', 1100),
      msg('student', 'q', 2000),
      msg('persona', 'a2', 2100),
      msg('student', 'u', 3000),
      msg('persona', 'x', 3050),
      msg('student', 'u', 3100),
      msg('student', 'q', 1000 + COLLAPSE_WINDOW_MS + 5000),
      msg('persona', 'a1', 1000 + COLLAPSE_WINDOW_MS + 5100),
    ]);
    expect(out).toHaveLength(9);
    expect(out.some((m) => m.repeat)).toBe(false);
  });
  it('leaves confirm cards alone', () => {
    const card = {
      type: 'confirm',
      taskId: 't',
      question: 'q',
      options: ['a'],
      status: 'pending',
    } as ChatMessage['card'];
    const out = collapseRepeatedPairs([
      msg('student', 'show', 1000),
      msg('persona', 'p', 1100, { card }),
      msg('student', 'show', 2000),
      msg('persona', 'p', 2100, { card }),
    ]);
    expect(out).toHaveLength(4);
  });
});
