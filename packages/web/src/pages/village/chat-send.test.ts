import { describe, expect, it, vi } from 'vitest';
import { createPhraseRunner, sendPhraseToChat } from './chat-send';

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
    expect(JSON.parse(String(init.body))).toMatchObject({ chatId: 'grp', text: '@cubbie quiz me' });
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

describe('send idempotency', () => {
  const hub = { hubUrl: 'http://h', token: 't' };
  it('carries a stable clientId and reuses it when the post is retried after a network error', async () => {
    let posts = 0;
    const bodies: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/chat/chats')) return json({ chats: [{ id: 'grp', kind: 'group' }] });
      posts += 1;
      bodies.push(String(init?.body));
      if (posts === 1) throw new Error('net');
      return json({ message: {} });
    });
    expect(await sendPhraseToChat(hub, '@cubbie quiz me', f as never)).toBe(true);
    const ids = bodies.map((b) => (JSON.parse(b) as { clientId: string }).clientId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });
  it('Run it pressed repeatedly sends once while pending and for a moment after', async () => {
    let release: (v: boolean) => void = () => {};
    const send = vi.fn(() => new Promise<boolean>((r) => (release = r)));
    let t = 1000;
    const run = createPhraseRunner(send as never, () => t);
    const a = run(hub, '@cubbie study plan');
    const b = run(hub, '@cubbie   study plan');
    expect(b).toBe(a);
    expect(send).toHaveBeenCalledTimes(1);
    release(true);
    await a;
    t += 1000;
    expect(run(hub, '@cubbie study plan')).toBe(a);
    expect(send).toHaveBeenCalledTimes(1);
    t += 5000; // later it is a deliberate second ask
    const c = run(hub, '@cubbie study plan');
    expect(c).not.toBe(a);
    expect(send).toHaveBeenCalledTimes(2);
    release(true);
    await c;
  });
});
