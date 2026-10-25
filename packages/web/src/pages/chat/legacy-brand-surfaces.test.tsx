// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ChatMessage, ChatSummary } from '@squad/core';
import { ChatView } from './ChatView';
import { GROUP_ID, ME, createFakeChatApi, type FakeChatApi } from './fixtures';
import { useChat } from './useChat';
import { previewLine } from './model';

const memStorage = (): Storage => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0));
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('sessionStorage', memStorage());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const at = (n: number) => new Date(2026, 9, 15, 11, n).getTime();
const legacy = (over: Partial<ChatMessage>): ChatMessage =>
  ({ chatId: GROUP_ID, citations: [], attachments: [], ...over }) as ChatMessage;

/** Old stored history: the assistant was 'Cubbie', and instructions told people to say @cubbie / @squad. */
const LEGACY: ChatMessage[] = [
  legacy({
    id: 'old1',
    seq: 1,
    ts: at(1),
    sender: { kind: 'persona', id: 'cubbie', name: 'Cubbie' },
    text: 'Reply "@cubbie plan 1" to accept, "@squad plan 2" to decline.',
  }),
  legacy({
    id: 'old2',
    seq: 2,
    ts: at(2),
    sender: { kind: 'system', name: 'Squad' },
    text: 'Tip: say @cubbi help',
  }),
  legacy({
    id: 'old3',
    seq: 3,
    ts: at(3),
    sender: { kind: 'persona', id: 'cubbie', name: 'Cubbie' },
    text: 'Confirm?',
    card: {
      type: 'confirm',
      taskId: 't1',
      question: 'Should @cubbie book it?',
      options: ['Yes', 'No'],
      status: 'pending',
    },
  }),
];

function withLegacyHistory(base: FakeChatApi): FakeChatApi {
  return Object.assign(Object.create(base) as FakeChatApi, {
    history: async (chatId: string) => ({
      messages: chatId === GROUP_ID ? LEGACY : [],
      hasMore: false,
    }),
  });
}

function Harness({ api }: { api: FakeChatApi }) {
  const ctl = useChat(api, { me: ME });
  return <ChatView ctl={ctl} activeId={GROUP_ID} onActiveChange={() => {}} />;
}

describe('legacy assistant history renders as Nook (display only)', () => {
  it('thread: author, instructions, system notice and confirm question', async () => {
    const base = createFakeChatApi({ bot: false });
    const api = withLegacyHistory(base);
    const { container } = render(<Harness api={api} />);
    await waitFor(() =>
      expect(container.querySelectorAll('[data-testid="chat-message"]').length).toBeGreaterThan(1),
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Reply "@nook plan 1" to accept, "@nook plan 2" to decline.');
    expect(text).toContain('Tip: say @nook help');
    expect(text).toContain('Should @nook book it?');
    expect(text).not.toMatch(/@cubbie|@cubbi\b|@squad/i);
    const names = [...container.querySelectorAll('.sqc-msg__name')].map((n) => n.textContent);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === 'Nook')).toBe(true);
    expect(screen.queryByText('Cubbie')).toBeNull();
    // stored history is not rewritten
    expect(LEGACY[0]!.text).toContain('@cubbie plan 1');
    expect(LEGACY[0]!.sender).toMatchObject({ name: 'Cubbie' });
  });

  it('chat list preview', () => {
    const chat = {
      id: GROUP_ID,
      kind: 'group',
      title: 'Demo squad',
      last: { text: 'Say @cubbie quiz me', ts: 1, seq: 2, senderName: 'Cubbie' },
    } as unknown as ChatSummary;
    expect(previewLine(chat)).toBe('Nook: Say @nook quiz me');
    expect(chat.last?.text).toBe('Say @cubbie quiz me');
  });
});
