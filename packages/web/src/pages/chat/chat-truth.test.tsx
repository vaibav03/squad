// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatMessage, ChatSummary } from '@squad/core';
import { ChatCouncilCard, summarize } from '../../council/ChatCouncilCard';
import { ChatCardActionsContext } from '../../council/card-actions';
import { councilFixtures as f } from '../../council/fixtures';
import { AnswerWait } from './AnswerWait';
import {
  dropRedelivered,
  waitingTriggers,
  waitPhase,
  SLOW_AFTER_MS,
  type ThreadItem,
} from './model';
import type { ChatController } from './useChat';

afterEach(cleanup);

let n = 0;
const msg = (
  kind: 'student' | 'persona',
  text: string,
  ts: number,
  x: Partial<ChatMessage> = {},
) => {
  n += 1;
  const m: ChatMessage = {
    id: `m${n}`,
    seq: n,
    chatId: 'group:g',
    ts,
    sender:
      kind === 'student' ? { kind, id: 'me', name: 'Me' } : { kind, id: 'cubbie', name: 'Cubbie' },
    text,
    private: false,
    attachments: [],
    citations: [],
    demo: false,
    ...x,
  };
  return { message: m, state: 'sent' as const } satisfies ThreadItem;
};

describe('ChatCouncilCard', () => {
  it('shows summary, dissent, next action, collapsed member rows, then expands', () => {
    const fill = vi.fn();
    render(
      <ChatCardActionsContext.Provider value={{ fill, cite: vi.fn() }}>
        <ChatCouncilCard result={f.done} />
      </ChatCardActionsContext.Provider>,
    );
    const card = screen.getByTestId('council-chat-card');
    expect(within(card).getByTestId('council-summary')).toBeTruthy();
    for (const h of ['Summary', 'Next action'])
      expect(within(card).getByRole('heading', { name: h })).toBeTruthy();
    for (const b of ['Add to plan', 'Ask follow-up'])
      expect(within(card).getByRole('button', { name: b })).toBeTruthy();
    // members are collapsed by default
    const toggle = within(card).getByTestId('council-members-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(card.querySelector('.sqc-members')!.hasAttribute('hidden')).toBe(true);
    fireEvent.click(toggle);
    const rows = within(card).getAllByTestId('council-member-row');
    expect(rows.length).toBe(f.done.members.length);
    const first = within(rows[0]!).getByRole('button');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(first);
    expect(rows[0]!.textContent).toContain(f.done.members[0]!.text.slice(0, 20));
    fireEvent.click(within(card).getByTestId('council-follow-up'));
    expect(fill).toHaveBeenCalledWith('@cubbie ask the council: ');
  });

  it('is the only visible text: the plain verdict is screen-reader only', () => {
    render(<ChatCouncilCard result={f.done} />);
    const sr = screen.getByTestId('council-chat-card').querySelector('.sq-sr-only')!;
    expect(sr.textContent).toContain('Council verdict');
  });

  it('summarize keeps one to two sentences', () => {
    expect(summarize('One. Two. Three. Four.')).toBe('One. Two.');
  });

  it('a fixture run is labelled Demo on the card itself', () => {
    render(<ChatCouncilCard result={{ ...f.done, demo: true, mode: 'demo' }} />);
    expect(screen.getByTestId('council-chat-card').getAttribute('data-mode')).toBe('demo');
  });
});

describe('redelivery and waiting', () => {
  it('hides the same z-score answer delivered three times for one trigger', () => {
    const q = msg('student', '@cubbie what is a z-score?', 1000);
    const a = (i: number) =>
      msg('persona', 'A z-score is a distance in standard deviations.', 1100 + i, {
        replyTo: q.message.id,
      });
    const out = dropRedelivered([q, a(0), a(1), a(2)]);
    expect(out.filter((i) => i.message.sender.kind === 'persona')).toHaveLength(1);
  });
  it('hides identical consecutive bot text without a trigger id, keeps different answers', () => {
    const out = dropRedelivered([
      msg('student', 'q', 1),
      msg('persona', 'same', 2),
      msg('persona', 'same', 3),
      msg('persona', 'different', 4),
    ]);
    expect(out.map((i) => i.message.text)).toEqual(['q', 'same', 'different']);
  });
  it('drops a "Not in the materials" fallback that trails a cited answer for the same trigger', () => {
    const q = msg('student', '@cubbie what is a z-score?', 1000);
    const real = msg('persona', 'A z-score is a distance in standard deviations.', 1100, {
      replyTo: q.message.id,
      citations: [{ file: 'ch6.pdf', page: 2, label: 'ch6.pdf p.2' }],
    });
    const fb = msg('persona', 'Not in the materials. Ask the TA.', 1200, { replyTo: q.message.id });
    expect(dropRedelivered([q, real, fb]).map((i) => i.message.text)).toEqual([
      q.message.text,
      real.message.text,
    ]);
    // alone it is a legitimate answer
    expect(dropRedelivered([q, fb])).toHaveLength(2);
  });
  it('one waiting entry per unanswered trigger, none once answered', () => {
    const q1 = msg('student', '@cubbie one', Date.now() - 1000, { clientId: 'c1' });
    const q2 = msg('student', '@cubbie two', Date.now() - 500, { clientId: 'c2' });
    const w = waitingTriggers([q1, q2], 'me', false, Date.now());
    expect(w.map((x) => x.clientId)).toEqual(['c1', 'c2']);
    const ans = msg('persona', 'hi', Date.now(), { replyTo: q1.message.id });
    expect(waitingTriggers([q1, q2, ans], 'me', false, Date.now()).map((x) => x.clientId)).toEqual([
      'c2',
    ]);
    expect(
      waitingTriggers([msg('student', 'no mention', Date.now())], 'me', false, Date.now()),
    ).toEqual([]);
  });
  it('phases', () => {
    expect(waitPhase(1000, false)).toBe('thinking');
    expect(waitPhase(SLOW_AFTER_MS, false)).toBe('slow');
    expect(waitPhase(1000, true)).toBe('failed');
  });
});

describe('AnswerWait', () => {
  const chat = { id: 'group:g', kind: 'group' } as ChatSummary;
  it('one placeholder, elapsed time after 8s, retry reuses the same clientId', async () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const q = msg('student', '@cubbie what is a z-score?', t0, { clientId: 'c_1' });
      const retryAnswer = vi.fn(async () => true);
      const ctl = { me: 'me', online: true, retryAnswer } as unknown as ChatController;
      render(<AnswerWait chat={chat} ctl={ctl} items={[q]} reduced typing={[]} />);
      expect(screen.getAllByTestId('chat-wait')).toHaveLength(1);
      expect(screen.getByTestId('chat-wait-text').textContent).toBe('Cubbie is thinking…');
      expect(screen.queryByTestId('chat-wait-retry')).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(9000);
      });
      expect(screen.getAllByTestId('chat-wait')).toHaveLength(1);
      expect(screen.getByTestId('chat-wait-text').textContent).toMatch(
        /9s.*taking longer than usual/,
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId('chat-wait-retry'));
      });
      expect(retryAnswer).toHaveBeenCalledTimes(1);
      const call = retryAnswer.mock.calls[0] as unknown as [string, ChatMessage];
      expect(call[1].clientId).toBe('c_1');
      expect(screen.getAllByTestId('chat-wait')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a failed retry shows one "Could not get an answer" row', async () => {
    const q = msg('student', '@cubbie hi', Date.now() - 20000, { clientId: 'c_2' });
    const ctl = {
      me: 'me',
      online: true,
      retryAnswer: async () => false,
    } as unknown as ChatController;
    render(<AnswerWait chat={chat} ctl={ctl} items={[q]} reduced typing={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-wait-retry'));
    });
    expect(screen.getAllByTestId('chat-wait')).toHaveLength(1);
    expect(screen.getByTestId('chat-wait-text').textContent).toMatch(/^Could not get an answer: /);
  });
});
