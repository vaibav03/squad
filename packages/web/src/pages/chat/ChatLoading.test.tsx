// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage, ChatSummary } from '@squad/core';
import { ChatView } from './ChatView';
import { ChatDock } from './ChatDock';
import { createChatApi } from './api';
import { useChat } from './useChat';

/**
 * The loading path end to end through the real http client (fake fetch + fake EventSource): chat list and thread
 * go loading -> content / empty / error -> Retry, nothing waits forever, and a send is honest about its state.
 */
const ME = 'u_a193aba6d4e4';
const GID = 'group:sq_real';
const summary = (): ChatSummary[] => [
  {
    id: GID,
    kind: 'group',
    title: 'Real Squad',
    private: false,
    members: [{ id: ME, name: 'Float Real' }],
  },
];
const msg = (id: number, text: string, sender = ME): ChatMessage => ({
  id: `m_${id}`,
  seq: id,
  chatId: GID,
  ts: Date.now(),
  sender: { kind: 'student', id: sender, name: 'Float Real' },
  text,
  private: false,
  attachments: [],
  citations: [],
  demo: false,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

class FakeES {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  addEventListener() {}
  close() {}
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;
/** a hub whose routes can be swapped per test; a handler that never resolves stands for a hung hub */
function hub(over: Partial<Record<'chats' | 'history' | 'send', Handler>> = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url.replace('http://hub', '')}`);
    const hang = (h: Handler) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
        void Promise.resolve(h(url, init)).then(resolve, reject);
      });
    if (url.includes('/v1/status')) return json({ llm: true, tts: false, demo: false });
    if (url.includes('/v1/chat/file-token')) return json({ ft: 'f', expiresAt: Date.now() + 1e7 });
    if (url.includes('/v1/squad/stream-token')) return json({ st: 'st' });
    if (url.includes('/v1/chat/chats'))
      return hang(over.chats ?? (() => json({ chats: summary() })));
    if (url.includes('/v1/chat/history'))
      return hang(over.history ?? (() => json({ chatId: GID, messages: [], hasMore: false })));
    if (url.includes('/v1/chat/send'))
      return hang(
        over.send ??
          ((_u, i) => {
            const b = JSON.parse(String(i?.body)) as { text: string };
            return json({ message: msg(7, b.text) }, 202);
          }),
      );
    return json({}, 404);
  }) as unknown as typeof fetch;
  const api = createChatApi({
    hubUrl: 'http://hub',
    token: 't',
    fetchImpl,
    EventSourceImpl: FakeES as unknown as typeof EventSource,
    timeoutMs: 300,
  });
  return { api, calls };
}
const never: Handler = () => new Promise<Response>(() => {});

function Page({ api, id }: { api: ReturnType<typeof hub>['api']; id?: string }) {
  const ctl = useChat(api, { me: ME });
  return <ChatView ctl={ctl} activeId={id ?? GID} onActiveChange={() => {}} />;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const retryBtn = () => screen.findByRole('button', { name: 'Retry' });

describe('full page: chat list', () => {
  it('loading -> list', async () => {
    render(<Page api={hub().api} />);
    expect(screen.getByText('Loading chats')).toBeTruthy();
    expect(await screen.findByTestId(`chat-row-${GID}`)).toBeTruthy();
    expect(screen.queryByText('Loading chats')).toBeNull();
  });

  it('loading -> "No chats yet" when the account has none', async () => {
    render(<Page api={hub({ chats: () => json({ chats: [] }) }).api} />);
    expect(await screen.findAllByText('No chats yet')).toBeTruthy();
    expect(screen.queryByText('Loading chats')).toBeNull();
  });

  it('a hung hub times out into an error with a reason and Retry, then recovers', async () => {
    let hung = true;
    render(
      <Page
        api={hub({ chats: (...a) => (hung ? never(...a) : json({ chats: summary() })) }).api}
      />,
    );
    expect(await screen.findByText(/too long to answer/)).toBeTruthy();
    expect(screen.queryByText('Loading chats')).toBeNull();
    hung = false;
    fireEvent.click(await retryBtn());
    expect(await screen.findByTestId(`chat-row-${GID}`)).toBeTruthy();
  });

  it('a 500 explains itself; an unreachable hub says so', async () => {
    const { unmount } = render(<Page api={hub({ chats: () => json({}, 500) }).api} />);
    expect(await screen.findByText(/problem answering/)).toBeTruthy();
    unmount();
    render(
      <Page api={hub({ chats: () => Promise.reject(new TypeError('Failed to fetch')) }).api} />,
    );
    expect(await screen.findByText(/could not reach the hub/)).toBeTruthy();
  });

  it('offline: the reason is the connection, with Retry', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    render(<Page api={hub({ chats: () => Promise.reject(new TypeError('x')) }).api} />);
    expect(await screen.findByText(/You are offline/)).toBeTruthy();
    expect(await retryBtn()).toBeTruthy();
  });
});

describe('thread: history', () => {
  it('loading -> messages, own message is mine for a u_ account', async () => {
    render(
      <Page
        api={
          hub({ history: () => json({ chatId: GID, messages: [msg(1, 'hello')], hasMore: false }) })
            .api
        }
      />,
    );
    const m = await screen.findByTestId('chat-message');
    expect(m.getAttribute('data-own')).toBe('true');
  });

  it('loading -> "No messages yet, say hi"', async () => {
    render(<Page api={hub().api} />);
    expect(await screen.findByText('No messages yet, say hi')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('status', { name: 'Loading messages' })).toBeNull(),
    );
  });

  it('never flashes the empty state before the history answer arrives', async () => {
    let release: (r: Response) => void = () => {};
    const gate = new Promise<Response>((r) => (release = r));
    render(<Page api={hub({ history: () => gate }).api} />);
    await screen.findByTestId('chat-thread');
    expect(screen.queryByText('No messages yet, say hi')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeTruthy();
    release(json({ chatId: GID, messages: [msg(1, 'first one')], hasMore: false }));
    expect(await screen.findByText('first one')).toBeTruthy();
    expect(screen.queryByText('No messages yet, say hi')).toBeNull();
  });

  it('history hang -> error with reason -> Retry -> messages', async () => {
    let hung = true;
    render(
      <Page
        api={
          hub({
            history: (...a) =>
              hung
                ? never(...a)
                : json({ chatId: GID, messages: [msg(1, 'back')], hasMore: false }),
          }).api
        }
      />,
    );
    expect(await screen.findByText(/too long to answer/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading messages' })).toBeNull();
    hung = false;
    fireEvent.click(await retryBtn());
    expect(await screen.findByText('back')).toBeTruthy();
  });

  it('403 on history says you do not have access', async () => {
    render(<Page api={hub({ history: () => json({ error: { code: 'forbidden' } }, 403) }).api} />);
    expect(await screen.findByText(/do not have access/)).toBeTruthy();
  });
});

describe('send: optimistic and honest', () => {
  const type = async (t: string) => {
    const box = (await screen.findByTestId('chat-composer-input')) as HTMLTextAreaElement;
    await userEvent.type(box, `${t}{Enter}`);
    return box;
  };

  it('shows Sending immediately, then Sent when the hub acks', async () => {
    let release: (r: Response) => void = () => {};
    render(
      <Page
        api={
          hub({
            send: () =>
              new Promise<Response>((r) => {
                release = r;
              }),
          }).api
        }
      />,
    );
    await type('Customer test: hello squad');
    expect(await screen.findByText('Sending')).toBeTruthy();
    expect(screen.getByText('Customer test: hello squad')).toBeTruthy();
    release(json({ message: msg(7, 'Customer test: hello squad') }, 202));
    expect(await screen.findByText('Sent')).toBeTruthy();
    expect(screen.queryByText('Sending')).toBeNull();
    expect(screen.getAllByText('Customer test: hello squad')).toHaveLength(1);
  });

  it('a failed send keeps the text as a bubble with Retry and Delete; Retry reuses the clientId', async () => {
    let fail = true;
    const ids: string[] = [];
    render(
      <Page
        api={
          hub({
            send: (_u, i) => {
              const b = JSON.parse(String(i?.body)) as { text: string; clientId: string };
              ids.push(b.clientId);
              return fail
                ? json({ error: { code: 'x' } }, 500)
                : json({ message: msg(7, b.text) }, 202);
            },
          }).api
        }
      />,
    );
    const box = await type('keep me');
    const a = await screen.findByRole('alert');
    expect(a.textContent).toContain('Failed to send');
    expect(screen.getByText('keep me')).toBeTruthy();
    expect(box.value).toBe('');
    expect(within(a).getByRole('button', { name: 'Delete' })).toBeTruthy();
    fail = false;
    fireEvent.click(within(a).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Sent')).toBeTruthy();
    expect(new Set(ids).size).toBe(1);
  });

  it('a send that times out becomes Failed to send, not a silent vanish', async () => {
    render(<Page api={hub({ send: never }).api} />);
    await type('slow one');
    expect(await screen.findByText('Sending')).toBeTruthy();
    const a = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(a.textContent).toContain('Failed to send');
    expect(screen.getByText('slow one')).toBeTruthy();
  });

  it('the Send button reflects state', async () => {
    render(<Page api={hub().api} />);
    const btn = (await screen.findByTestId('chat-send')) as HTMLButtonElement;
    expect(btn.getAttribute('data-state')).toBe('empty');
    expect(btn.disabled).toBe(true);
    await userEvent.type(await screen.findByTestId('chat-composer-input'), 'x');
    expect(btn.getAttribute('data-state')).toBe('ready');
    expect(btn.disabled).toBe(false);
  });
});

describe('floating dock', () => {
  const open = async () => fireEvent.click(await screen.findByTestId('chat-dock-open'));

  it('hung hub -> error with reason and Retry (never an endless skeleton) -> messages', async () => {
    let hung = true;
    render(
      <ChatDock
        enabled
        me={ME}
        api={hub({ chats: (...a) => (hung ? never(...a) : json({ chats: summary() })) }).api}
      />,
    );
    await open();
    expect(await screen.findByText(/too long to answer/)).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading chat' })).toBeNull();
    hung = false;
    fireEvent.click(screen.getByTestId('chat-dock-retry'));
    expect(await screen.findByText('No messages yet, say hi')).toBeTruthy();
  });

  it('no group chat yet -> "No chats yet" with Retry, not a permanent skeleton', async () => {
    render(<ChatDock enabled me={ME} api={hub({ chats: () => json({ chats: [] }) }).api} />);
    await open();
    expect(await screen.findByText('No chats yet')).toBeTruthy();
    expect(screen.getByTestId('chat-dock-retry')).toBeTruthy();
  });

  it('history hang -> Messages did not load + Retry', async () => {
    render(<ChatDock enabled me={ME} api={hub({ history: never }).api} />);
    await open();
    expect(await screen.findByText(/too long to answer/, {}, { timeout: 3000 })).toBeTruthy();
    expect(await retryBtn()).toBeTruthy();
  });

  it('optimistic send in the dock: Sending then Sent', async () => {
    render(<ChatDock enabled me={ME} api={hub().api} />);
    await open();
    const box = await screen.findByTestId('chat-composer-input');
    await userEvent.type(box, 'Customer test: hello squad{Enter}');
    await waitFor(() => expect(screen.getByText('Sent')).toBeTruthy());
  });
});
