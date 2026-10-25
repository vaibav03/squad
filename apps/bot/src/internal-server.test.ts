import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createInternalServer } from './internal-server';
import { createTestBot } from './testing';

const open: { close(): void }[] = [];
afterEach(() => open.splice(0).forEach((s) => s.close()));

async function setup(opts = {}) {
  const t = createTestBot(opts);
  const server = createInternalServer({ confirms: t.bot.confirms, secret: 's3cret' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  open.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/confirm`;
  const post = (body: unknown, secret?: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'X-Nook-Internal': secret } : {}),
      },
      body: JSON.stringify(body),
    });
  return { t, post, url };
}
const body = { student: 's_ana', question: 'Book Friday?', options: ['Yes', 'No'], taskId: 'T1' };
// Poll until the bot has sent `n` DMs (bounded 2 s) instead of sleeping a fixed time.
async function waitSent(t: { sent: unknown[] }, n: number, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (t.sent.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
  expect(t.sent.length).toBe(n);
}

describe('POST /internal/confirm', () => {
  it('rejects a missing or wrong secret with 401 and sends no DM', async () => {
    const { t, post } = await setup();
    expect((await post(body)).status).toBe(401);
    expect((await post(body, 'wrong')).status).toBe(401);
    expect(t.sent).toHaveLength(0);
  });

  it('DMs the student and answers { answer } with the chosen option', async () => {
    const { t, post } = await setup();
    const res = post(body, 's3cret');
    await waitSent(t, 1);
    expect(t.sent[0]!.chatId).toBe('dm:s_ana');
    await t.answerConfirm('s_ana', '2');
    const r = await res;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ answer: 'No' });
  });

  it('answers { answer: "timeout" } when the student never replies', async () => {
    const { post } = await setup({ confirmTimeoutMs: 30 });
    const r = await post(body, 's3cret');
    expect(await r.json()).toEqual({ answer: 'timeout' });
  });

  it('400 on a bad body, 409 on a duplicate taskId, 404/405 elsewhere', async () => {
    const { t, post, url } = await setup();
    expect((await post({ student: 's_ana' }, 's3cret')).status).toBe(400);
    expect((await post({ ...body, options: [] }, 's3cret')).status).toBe(400);
    void post(body, 's3cret');
    await waitSent(t, 1);
    expect((await post(body, 's3cret')).status).toBe(409);
    expect((await fetch(url, { headers: { 'X-Nook-Internal': 's3cret' } })).status).toBe(405);
    expect((await fetch(url.replace('confirm', 'x'), { method: 'POST' })).status).toBe(404);
  });
});
