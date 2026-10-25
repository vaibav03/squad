import { describe, expect, it, vi } from 'vitest';
import { sendPhraseToChat } from './chat-send';

const json = (b: unknown, ok = true) => ({ ok, json: async () => b }) as Response;

describe('sendPhraseToChat', () => {
  it('posts the phrase to the group chat', async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith('/v1/chat/chats')
        ? json({
            chats: [
              { id: 'dm1', kind: 'dm' },
              { id: 'grp', kind: 'group' },
            ],
          })
        : json({ message: {} }),
    );
    expect(
      await sendPhraseToChat({ hubUrl: 'http://h/', token: 't' }, '@cubbie quiz me', f as never),
    ).toBe(true);
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('http://h/v1/chat/send');
    expect(JSON.parse(String(init.body))).toEqual({ chatId: 'grp', text: '@cubbie quiz me' });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });
  it('fails closed without a token, a group, or a reachable hub', async () => {
    expect(await sendPhraseToChat({ hubUrl: 'http://h', token: null }, 'x', vi.fn() as never)).toBe(
      false,
    );
    const none = vi.fn(async () => json({ chats: [{ id: 'dm1', kind: 'dm' }] }));
    expect(await sendPhraseToChat({ hubUrl: 'http://h', token: 't' }, 'x', none as never)).toBe(
      false,
    );
    const down = vi.fn(async () => {
      throw new Error('net');
    });
    expect(await sendPhraseToChat({ hubUrl: 'http://h', token: 't' }, 'x', down as never)).toBe(
      false,
    );
  });
});
