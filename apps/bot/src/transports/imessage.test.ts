import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { InboundMessage } from '@squad/core';
import { TEST_ROSTER } from '../testing';
import { SendLimiter } from './common';
import {
  createIMessageTransport,
  type IMessageMessageLike,
  type IMessageSdkLike,
} from './imessage';

function fakeSdk() {
  let events: Parameters<IMessageSdkLike['startWatching']>[0] = {};
  const sends: { to: string; text?: string; attachments?: readonly string[] }[] = [];
  const sdk: IMessageSdkLike & { emit(m: IMessageMessageLike): Promise<void>; failSends: number } =
    {
      failSends: 0,
      async startWatching(e) {
        events = e;
      },
      stopWatching: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      async listChats() {
        return [{ chatId: 'iMessage;+;chat1', name: 'Nook Test', kind: 'group' }];
      },
      async send(r) {
        if (sdk.failSends > 0) {
          sdk.failSends--;
          throw new Error('applescript failed');
        }
        sends.push(r);
      },
      emit: async (m) => events.onIncomingMessage?.(m),
    };
  return { sdk, sends };
}

const raw = (o: Partial<IMessageMessageLike> = {}): IMessageMessageLike => ({
  id: 'g1',
  chatId: 'iMessage;+;chat1',
  chatKind: 'group',
  participant: '+15550000100',
  text: 'hello',
  kind: 'text',
  isFromMe: false,
  createdAt: new Date(1_700_000_000_000),
  attachments: [],
  ...o,
});

async function setup() {
  const { sdk, sends } = fakeSdk();
  const clock = 0;
  const t = createIMessageTransport({
    roster: TEST_ROSTER,
    sdk,
    sendLimiter: new SendLimiter(0),
    now: () => clock,
    fileExists: () => true,
  });
  const got: InboundMessage[] = [];
  await t.start((m) => void got.push(m));
  return { t, sdk, sends, got };
}

describe('imessage transport', () => {
  it('normalizes a group message', async () => {
    const { sdk, got } = await setup();
    await sdk.emit(raw({ text: '@cubbie hi' }));
    expect(got).toEqual([
      {
        chatId: 'iMessage;+;chat1',
        isGroup: true,
        from: 's_ana',
        text: '@cubbie hi',
        attachments: [],
        mentionsBot: true,
        ts: 1_700_000_000_000,
      },
    ]);
  });

  it('DMs get a stable dm:<student> chat id, always mention, and send back to the handle', async () => {
    const { t, sdk, got, sends } = await setup();
    await sdk.emit(
      raw({
        chatId: 'iMessage;-;+15550000101',
        chatKind: 'dm',
        participant: '+15550000101',
        text: 'hey',
      }),
    );
    expect(got[0]).toMatchObject({
      chatId: 'dm:s_ben',
      isGroup: false,
      from: 's_ben',
      mentionsBot: true,
    });
    await t.send({ chatId: t.dmChatId('s_ben'), text: 'yo' });
    expect(sends[0]).toEqual({ to: '+15550000101', text: 'yo' });
  });

  it('unknown senders become s_<last4>; DM to them uses the learned chat id', async () => {
    const { t, sdk, got, sends } = await setup();
    await sdk.emit(
      raw({ chatId: 'iMessage;-;x', chatKind: 'dm', participant: 'someone', text: 'hi' }),
    );
    expect(got[0]!.from).toBe('s_eone');
    await sdk.emit(
      raw({
        chatId: 'iMessage;-;+19998887777',
        chatKind: 'dm',
        participant: '+19998887777',
        text: 'hi',
      }),
    );
    expect(got[1]!.from).toBe('s_7777');
    await t.send({ chatId: 'dm:s_7777', text: 'reply' });
    expect(sends[0]!.to).toBe('iMessage;-;+19998887777');
  });

  it('drops isFromMe, reactions, non-text, chatless and empty rows; null text with attachment is kept', async () => {
    const { sdk, got } = await setup();
    await sdk.emit(raw({ isFromMe: true }));
    await sdk.emit(raw({ reaction: { kind: 'love' } }));
    await sdk.emit(raw({ kind: 'memberAdded' }));
    await sdk.emit(raw({ chatId: null }));
    await sdk.emit(raw({ text: null }));
    expect(got).toHaveLength(0);
    await sdk.emit(
      raw({
        text: null,
        attachments: [
          { localPath: '/tmp/a.png', mimeType: 'image/png' },
          { localPath: null, mimeType: 'image/png' },
        ],
      }),
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      text: '',
      attachments: [{ path: '/tmp/a.png', mime: 'image/png' }],
    });
  });

  it('rejects a second start, relative and missing attachment paths before calling the sdk', async () => {
    const { t, sends } = await setup();
    await expect(t.start(() => {})).rejects.toThrow(/already started/);
    await expect(
      t.send({ chatId: 'iMessage;+;chat1', attachments: [{ path: 'rel.png', mime: 'image/png' }] }),
    ).rejects.toThrow(/absolute/);
    const t2 = createIMessageTransport({
      roster: TEST_ROSTER,
      sdk: fakeSdk().sdk,
      sendLimiter: new SendLimiter(0),
    });
    await expect(
      t2.send({
        chatId: 'iMessage;+;chat1',
        attachments: [{ path: '/no/such/file.png', mime: 'image/png' }],
      }),
    ).rejects.toThrow(/not found/);
    expect(sends).toHaveLength(0);
  });

  it('sends attachments (real temp file) and retries once on failure, then surfaces', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'imk-')), 'a.m4a');
    writeFileSync(f, 'x');
    const { sdk, sends } = fakeSdk();
    const t = createIMessageTransport({
      roster: TEST_ROSTER,
      sdk,
      sendLimiter: new SendLimiter(0),
    });
    sdk.failSends = 1;
    await t.send({
      chatId: 'iMessage;+;chat1',
      text: 'listen',
      attachments: [{ path: f, mime: 'audio/mp4' }],
    });
    expect(sends[0]).toEqual({ to: 'iMessage;+;chat1', text: 'listen', attachments: [f] });
    sdk.failSends = 2;
    await expect(t.send({ chatId: 'iMessage;+;chat1', text: 'x' })).rejects.toThrow(/applescript/);
  });

  it('limits sends to the configured gap', async () => {
    let clock = 0;
    const slept: number[] = [];
    const lim = new SendLimiter(
      1000,
      () => clock,
      async (ms) => void slept.push(ms),
    );
    const { sdk } = fakeSdk();
    const t = createIMessageTransport({
      roster: TEST_ROSTER,
      sdk,
      sendLimiter: lim,
      now: () => clock,
    });
    await t.send({ chatId: 'g', text: 'a' });
    clock = 200;
    await t.send({ chatId: 'g', text: 'b' });
    expect(slept).toEqual([800]);
  });

  it('echo guard drops a recently sent text from an unknown sender', async () => {
    const { t, sdk, got } = await setup();
    await t.send({ chatId: 'iMessage;+;chat1', text: 'bot said this' });
    await sdk.emit(raw({ participant: null, text: 'bot said this' }));
    expect(got).toHaveLength(0);
    await sdk.emit(raw({ text: 'bot said this' })); // a real student repeating it is kept
    expect(got).toHaveLength(1);
  });

  it('stop closes the sdk', async () => {
    const { t, sdk } = await setup();
    await t.stop();
    expect(sdk.stopWatching).toHaveBeenCalled();
    expect(sdk.close).toHaveBeenCalled();
  });
});
