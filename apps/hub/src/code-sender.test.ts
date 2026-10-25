import { describe, expect, it } from 'vitest';
import {
  createConsoleCodeSender,
  createImessageCodeSender,
  createMemoryCodeSender,
} from './code-sender';
import { createLogger } from './log';

const msg = { channel: 'phone' as const, to: '+14155550134', hint: '•••• 0134', code: '123456' };

describe('code senders', () => {
  it('console sender logs the code next to the masked contact and never the number', async () => {
    const lines: string[] = [];
    await createConsoleCodeSender(createLogger('info', (l) => lines.push(l))).send(msg);
    expect(lines.join('')).toContain('123456');
    expect(lines.join('')).toContain('0134');
    expect(lines.join('')).not.toContain('4155550134');
  });
  it('memory sender collects', async () => {
    const m = createMemoryCodeSender();
    await m.send(msg);
    expect(m.last()?.code).toBe('123456');
  });
  it('imessage sender posts to the transport and falls back to the console on failure or email', async () => {
    const lines: string[] = [];
    const log = createLogger('info', (l) => lines.push(l));
    const calls: { url: string; body: string }[] = [];
    const ok = createImessageCodeSender({
      url: 'http://bot/send',
      log,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body) });
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await ok.send(msg);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ to: '+14155550134' });
    expect(lines.join('')).not.toContain('4155550134');

    const down = createImessageCodeSender({
      url: 'http://bot/send',
      log,
      fetch: (async () => new Response('no', { status: 500 })) as unknown as typeof fetch,
    });
    await down.send(msg);
    expect(lines.join('')).toContain('auth.code'); // fell back to the console
    lines.length = 0;
    await ok.send({ ...msg, channel: 'email', to: 'a@b.co', hint: 'a***@b.co' });
    expect(calls).toHaveLength(1); // email never goes to iMessage
    expect(lines.join('')).toContain('auth.code');
  });
});
