// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatView } from './ChatView';
import { ChatDock } from './ChatDock';
import {
  DM_ID,
  GROUP_ID,
  ME,
  createFakeChatApi,
  type FakeChatApi,
  type FakeChatOptions,
} from './fixtures';
import { useChat } from './useChat';
import { ChatApiError } from './api';

function Harness({ api, active }: { api: FakeChatApi; active: string }) {
  const ctl = useChat(api, { me: ME });
  return <ChatView ctl={ctl} activeId={active} onActiveChange={() => {}} />;
}
function setup(active = GROUP_ID, opts: FakeChatOptions = {}) {
  const api = createFakeChatApi({ bot: false, ...opts });
  const utils = render(<Harness api={api} active={active} />);
  return { api, ...utils };
}
const input = () => screen.findByTestId('chat-composer-input') as Promise<HTMLTextAreaElement>;
const reducedMatch = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

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
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('sessionStorage', memStorage());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.calm;
});

describe('thread rendering', () => {
  it('shows grouped messages, day separators and own messages', async () => {
    setup();
    await screen.findAllByTestId('chat-message');
    const msgs = screen.getAllByTestId('chat-message');
    expect(msgs[0]!.getAttribute('data-message-id')).toBe('m_1');
    expect(msgs[0]!.getAttribute('data-sender-id')).toBe('s_dev');
    expect(screen.getByText('Yesterday')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    // Chi's second consecutive message has no name header of its own
    // Chi writes two runs (yesterday, today); the second message of each run has no header
    expect(screen.getAllByText('Chi')).toHaveLength(2);
    const own = msgs.find((m) => m.getAttribute('data-sender-id') === ME)!;
    expect(own.getAttribute('data-own')).toBe('true');
  });

  it('the thread is a polite log', async () => {
    setup();
    const log = await screen.findByTestId('chat-thread');
    expect(log.getAttribute('role')).toBe('log');
    await waitFor(() => expect(log.getAttribute('aria-live')).toBe('polite'));
  });

  it('shows the privacy badge in a DM and not in the group', async () => {
    const dm = setup(DM_ID);
    await dm.findByTestId('chat-privacy-badge');
    expect(screen.getByTestId('chat-privacy-badge').textContent).toContain('Only you can see this');
    dm.unmount();
    setup(GROUP_ID);
    await screen.findByTestId('chat-thread');
    expect(screen.queryByTestId('chat-privacy-badge')).toBeNull();
  });

  it('labels bot bubbles as Demo and shows the notice only in demo mode', async () => {
    const a = setup(GROUP_ID, { demo: true });
    await screen.findAllByTestId('chat-message');
    expect(screen.getAllByTestId('chat-demo-label').length).toBeGreaterThan(0);
    expect(screen.getByTestId('chat-demo-notice').textContent).toContain('GEMINI_API_KEY');
    fireEvent.click(
      within(screen.getByTestId('chat-demo-notice')).getByRole('button', { name: 'Dismiss' }),
    );
    expect(screen.queryByTestId('chat-demo-notice')).toBeNull();
    // still labelled per bubble after the banner is dismissed
    expect(screen.getAllByTestId('chat-demo-label').length).toBeGreaterThan(0);
    a.unmount();
    sessionStorage.clear();
    setup(GROUP_ID, { demo: false });
    await screen.findAllByTestId('chat-message');
    expect(screen.queryByTestId('chat-demo-label')).toBeNull();
    expect(screen.queryByTestId('chat-demo-notice')).toBeNull();
  });

  it('applies the reduced motion class under Calm mode', async () => {
    document.documentElement.dataset.calm = 'true';
    const { container } = setup();
    await screen.findAllByTestId('chat-message');
    expect(container.querySelector('.sqc--reduced')).toBeTruthy();
  });

  it('applies the reduced motion class for prefers-reduced-motion and shows static typing text', async () => {
    reducedMatch(true);
    const { container, api } = setup();
    await screen.findAllByTestId('chat-message');
    expect(container.querySelector('.sqc--reduced')).toBeTruthy();
    act(() => api.pushTyping({ chatId: GROUP_ID, personaId: 'cubbie', name: 'Cubbie', on: true }));
    expect((await screen.findByTestId('chat-typing')).textContent).toContain('Cubbie is thinking');
  });

  it('typing dots clear when the bot answers', async () => {
    const { api } = setup();
    await screen.findAllByTestId('chat-message');
    act(() => api.pushTyping({ chatId: GROUP_ID, personaId: 'cubbie', name: 'Cubbie', on: true }));
    await screen.findByTestId('chat-typing');
    act(() => {
      api.pushMessage({
        chatId: GROUP_ID,
        ts: Date.now(),
        sender: { kind: 'persona', id: 'cubbie', name: 'Cubbie' },
        text: 'done',
        private: false,
        attachments: [],
        citations: [],
        demo: true,
      });
    });
    await waitFor(() => expect(screen.queryByTestId('chat-typing')).toBeNull());
  });

  it('shows an empty thread with quick prompts that fill the composer', async () => {
    setup(GROUP_ID, { empty: true });
    const chips = await screen.findAllByTestId('chat-prompt');
    expect(chips.map((c) => c.textContent)).toContain('@cubbie what is a z-score?');
    fireEvent.click(chips[0]!);
    await waitFor(async () => expect((await input()).value).toBe('@cubbie what is a z-score?'));
  });

  it('shows the designed offline state with no hub', () => {
    function NoHub() {
      const ctl = useChat(null, { me: ME });
      return <ChatView ctl={ctl} />;
    }
    render(<NoHub />);
    expect(screen.getByText('Chat is offline')).toBeTruthy();
  });

  it('shows the session ended state on 401', async () => {
    const api = createFakeChatApi({ bot: false });
    api.chats = () => Promise.reject(new ChatApiError(401));
    render(<Harness api={api} active={GROUP_ID} />);
    expect(await screen.findByText('Your session ended')).toBeTruthy();
    expect(screen.getByText('Sign in again.')).toBeTruthy();
  });

  it('shows an error with retry when the list does not load', async () => {
    const api = createFakeChatApi({ bot: false });
    api.failChats = true;
    render(<Harness api={api} active={GROUP_ID} />);
    expect(await screen.findByText('Chat did not load')).toBeTruthy();
    api.failChats = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findAllByTestId('chat-message');
  });

  it('shows an offline banner and pauses sending', async () => {
    setup();
    await screen.findAllByTestId('chat-message');
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(await screen.findByTestId('chat-offline')).toBeTruthy();
    expect(screen.getByTestId('chat-paused').textContent).toContain('offline');
    await userEvent.type(await input(), 'hello');
    expect((screen.getByTestId('chat-send') as HTMLButtonElement).disabled).toBe(true);
    act(() => void window.dispatchEvent(new Event('online')));
    await waitFor(() =>
      expect((screen.getByTestId('chat-send') as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('shows the offline banner when the stream drops', async () => {
    const { api } = setup();
    await screen.findAllByTestId('chat-message');
    act(() => api.setStream('offline'));
    expect(await screen.findByTestId('chat-offline')).toBeTruthy();
  });
});

describe('composer', () => {
  it('Enter sends, Shift+Enter makes a new line, and the box clears', async () => {
    const { api } = setup();
    const box = await input();
    await userEvent.type(box, 'one{Shift>}{Enter}{/Shift}two');
    expect(box.value).toBe('one\ntwo');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]).toMatchObject({ chatId: GROUP_ID, text: 'one\ntwo' });
    expect(box.value).toBe('');
  });

  it('keeps the send button disabled when empty and counts near the limit', async () => {
    setup();
    const box = await input();
    const send = screen.getByTestId('chat-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'x'.repeat(3600) } });
    expect(screen.getByText('3600 / 4000')).toBeTruthy();
    expect(send.disabled).toBe(false);
    fireEvent.change(box, { target: { value: 'x'.repeat(4001) } });
    expect(send.disabled).toBe(true);
  });

  it('attaches an image, sends it with the message, and lets you remove a preview', async () => {
    const { api } = setup(DM_ID);
    await input();
    const file = new File(['png'], 'diagram.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } });
    const remove = await screen.findByRole('button', { name: 'Remove diagram.png' });
    await waitFor(() =>
      expect((screen.getByTestId('chat-send') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(remove);
    expect(screen.queryByRole('button', { name: 'Remove diagram.png' })).toBeNull();
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } });
    await screen.findByRole('button', { name: 'Remove diagram.png' });
    await waitFor(() =>
      expect((screen.getByTestId('chat-send') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(api.sent).toHaveLength(1));
    expect(api.sent[0]!.attachments).toEqual([{ id: 'up_2' }]);
  });

  it('rejects a file that is not an image before uploading', async () => {
    setup();
    await input();
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [pdf] } });
    expect((await screen.findByRole('alert')).textContent).toMatch(/PNG/);
  });

  it('opens the mention list on @ in a group, navigates and picks with the keyboard', async () => {
    setup();
    const box = await input();
    await userEvent.type(box, 'hi @');
    const list = await screen.findByRole('listbox');
    const opts = within(list).getAllByRole('option');
    expect(opts.map((o) => o.textContent)).toEqual([
      expect.stringContaining('@cubbie'),
      expect.stringContaining('@squad'),
    ]);
    expect(box.getAttribute('aria-activedescendant')).toBe(opts[0]!.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(box.getAttribute('aria-activedescendant')).toBe(opts[1]!.id);
    await userEvent.keyboard('{Enter}');
    expect(box.value).toBe('hi @squad ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters mentions, Tab picks, Esc closes the list without sending', async () => {
    const { api } = setup();
    const box = await input();
    await userEvent.type(box, '@cu');
    expect(within(await screen.findByRole('listbox')).getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Tab}');
    expect(box.value).toBe('@cubbie ');
    await userEvent.type(box, ' and @');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(api.sent).toHaveLength(0);
  });

  it('has no mention list in a DM and says so', async () => {
    setup(DM_ID);
    const box = await input();
    await userEvent.type(box, '@');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText(/No @ needed/)).toBeTruthy();
  });

  it('"/" focuses the composer and Esc blurs it', async () => {
    setup();
    const box = await input();
    await userEvent.keyboard('/');
    expect(document.activeElement).toBe(box);
    expect(box.value).toBe('');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).not.toBe(box);
  });
});

describe('optimistic send', () => {
  it('shows a failed message with Retry and sends it again', async () => {
    const { api } = setup();
    const box = await input();
    api.failNextSend(500);
    await userEvent.type(box, 'will fail{Enter}');
    const failed = await screen.findByRole('alert');
    expect(failed.textContent).toContain('Not sent');
    expect(screen.getByText('will fail')).toBeTruthy();
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.sent).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
    expect(screen.getAllByText('will fail')).toHaveLength(1);
  });

  it('explains a rate limit in plain words and lets you remove the message', async () => {
    const { api } = setup();
    api.failNextSend(429);
    await userEvent.type(await input(), 'fast{Enter}');
    const a = await screen.findByRole('alert');
    expect(a.textContent).toContain('too fast');
    fireEvent.click(within(a).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByText('fast')).toBeNull();
  });
});

describe('citations', () => {
  it('opens the excerpt from a citation chip', async () => {
    setup();
    const chips = await screen.findAllByTestId('chat-citation-chip');
    expect(chips.map((c) => c.textContent)).toEqual(['1ch6.pdf p.4', '2ch6.pdf p.7']);
    fireEvent.click(chips[0]!);
    const ex = await screen.findByTestId('chat-citation-excerpt');
    await waitFor(() => expect(ex.textContent).toContain('how many standard deviations'));
    expect(ex.textContent).toContain('ch6.pdf, page 4');
  });

  it('shows an error with retry when the excerpt is missing', async () => {
    const { api } = setup();
    api.pushMessage({
      chatId: GROUP_ID,
      ts: Date.now(),
      sender: { kind: 'persona', id: 'cubbie', name: 'Cubbie' },
      text: 'See [ch9.pdf p.2]',
      private: false,
      attachments: [],
      citations: [{ file: 'ch9.pdf', page: 2, label: 'ch9.pdf p.2' }],
      demo: true,
    });
    const chip = (await screen.findAllByTestId('chat-citation-chip')).find(
      (c) => c.textContent === '1ch9.pdf p.2',
    )!;
    fireEvent.click(chip);
    expect((await screen.findByRole('alert', { name: '' })).textContent).toContain(
      'could not find',
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

describe('cards', () => {
  it('a quiz choice sends the letter, locks the card and points to the DM', async () => {
    const { api } = setup();
    const b = await screen.findByTestId('chat-quiz-choice-B');
    fireEvent.click(b);
    await waitFor(() => expect(api.sent).toEqual([{ chatId: GROUP_ID, text: '@cubbie B' }]));
    const sent = await screen.findByTestId('chat-quiz-sent');
    expect(sent.textContent).toContain('Answer sent, feedback in your DM');
    expect((screen.getByTestId('chat-quiz-choice-A') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('chat-quiz-choice-B').getAttribute('aria-pressed')).toBe('true');
    // answered state is the viewer's own and survives a reload
    expect(JSON.parse(localStorage.getItem(`squad.chat.quiz.${ME}`)!)).toEqual({ m_10: 'B' });
    expect(document.body.textContent).not.toMatch(/\bXP\b|streak|score:/i);
  });

  it('a confirm option sends its 1-based number to the DM', async () => {
    const { api } = setup(DM_ID);
    const two = await screen.findByTestId('chat-confirm-option-2');
    fireEvent.click(two);
    await waitFor(() => expect(api.sent).toEqual([{ chatId: DM_ID, text: '2' }]));
    expect(await screen.findByText(/Answer sent/)).toBeTruthy();
    expect((screen.getByTestId('chat-confirm-option-1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a confirm card follows chat.update to answered and timeout', async () => {
    const { api } = setup(DM_ID);
    await screen.findByTestId('chat-confirm-option-1');
    const m = api.data.messages[DM_ID]!.find((x) => x.card?.type === 'confirm')!;
    act(() =>
      api.pushUpdate({
        chatId: DM_ID,
        messageId: m.id,
        card: {
          ...(m.card as { type: 'confirm' }),
          type: 'confirm',
          taskId: 't',
          question: 'q',
          options: ['Yes, book it', 'Pick another time', 'Not now'],
          status: 'answered',
          answer: 'Not now',
        },
      }),
    );
    expect(await screen.findByText('You chose: Not now')).toBeTruthy();
    act(() =>
      api.pushUpdate({
        chatId: DM_ID,
        messageId: m.id,
        card: {
          type: 'confirm',
          taskId: 't',
          question: 'q',
          options: ['Yes, book it', 'Pick another time', 'Not now'],
          status: 'timeout',
        },
      }),
    );
    expect(await screen.findByText(/timed out/)).toBeTruthy();
  });
});

describe('unread', () => {
  it('counts unread per chat and clears it when opened', async () => {
    const api = createFakeChatApi({ bot: false });
    function Two() {
      const ctl = useChat(api, { me: ME });
      return <ChatView ctl={ctl} activeId={GROUP_ID} onActiveChange={() => {}} />;
    }
    render(<Two />);
    await screen.findAllByTestId('chat-message');
    // the DM was never opened: it shows unread; the open group does not
    expect(screen.queryByTestId(`chat-unread-${GROUP_ID}`)).toBeNull();
    act(() => {
      api.pushMessage({
        chatId: DM_ID,
        ts: Date.now(),
        sender: { kind: 'persona', id: 'cubbie', name: 'Cubbie' },
        text: 'ping',
        private: true,
        attachments: [],
        citations: [],
        demo: true,
      });
    });
    await waitFor(() => expect(screen.getByTestId(`chat-unread-${DM_ID}`)).toBeTruthy());
  });
});

describe('village dock', () => {
  it('renders nothing when disabled (replay mode or no token)', () => {
    const api = createFakeChatApi();
    const { container } = render(<ChatDock enabled={false} api={api} me={ME} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('chat-dock-open')).toBeNull();
  });

  it('opens a compact panel, keeps keys from the game, Esc closes and returns focus', async () => {
    const api = createFakeChatApi({ bot: false });
    render(<ChatDock enabled api={api} me={ME} />);
    const pill = screen.getByTestId('chat-dock-open');
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    fireEvent.click(pill);
    const box = await input();
    await waitFor(() => expect(document.activeElement).toBe(box));
    await userEvent.keyboard('wasd');
    expect(box.value).toBe('wasd');
    expect(onWindowKey).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('chat-composer-input')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(pill));
    // closed: keys reach the window again
    await userEvent.keyboard('w');
    expect(onWindowKey).toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowKey);
  });

  it('shows an unread badge while closed', async () => {
    const api = createFakeChatApi({ bot: false });
    render(<ChatDock enabled api={api} me={ME} />);
    await screen.findByTestId('chat-dock-unread');
  });
});
