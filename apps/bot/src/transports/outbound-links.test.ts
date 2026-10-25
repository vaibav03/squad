import { describe, expect, it } from 'vitest';
import { FakeIMessageTransport } from '../imessage/fake';
import { TEST_ROSTER } from '../testing';
import { SendLimiter } from './common';
import { createIMessageTransport } from './imessage';

const REPLY =
  'Nothing is connected yet: connect Canvas or Google in [Connections](/squad/connections). Council: /squad?council=cn_abc123def456';

describe('outbound iMessage text uses absolute plain links', () => {
  const make = (webUrl?: string | null) => {
    const sdk = new FakeIMessageTransport();
    const t = createIMessageTransport({
      roster: TEST_ROSTER,
      sdk,
      sendLimiter: new SendLimiter(0),
      ...(webUrl !== undefined ? { webUrl } : {}),
    });
    return { sdk, t };
  };

  it('with a public web URL: absolute URL, no markdown link syntax', async () => {
    const { sdk, t } = make('https://squad.example.org/');
    await t.send({ chatId: 'iMessage;+;chat1', text: REPLY });
    const text = sdk.sent[0]!.text!;
    expect(text).toContain('in Connections https://squad.example.org/squad/connections.');
    expect(text).toContain('https://squad.example.org/squad?council=cn_abc123def456');
    expect(text).not.toMatch(/\]\(|\(\/squad|\s\/squad/);
  });

  it('without one: the page name, no link at all', async () => {
    for (const none of [undefined, null, '']) {
      const { sdk, t } = make(none);
      await t.send({ chatId: 'iMessage;+;chat1', text: REPLY });
      const text = sdk.sent[0]!.text!;
      expect(text).toContain('in Connections.');
      expect(text).toContain('Council: the Council board');
      expect(text).not.toMatch(/\]\(|\/squad|https?:/);
    }
  });

  it('text without links is untouched', async () => {
    const { sdk, t } = make('https://squad.example.org');
    await t.send({ chatId: 'iMessage;+;chat1', text: 'Chapter 6 is on page 3.' });
    expect(sdk.sent[0]!.text).toBe('Chapter 6 is on page 3.');
  });
});
