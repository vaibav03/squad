import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createBot } from '../bot';
import { chatSkill } from '../skills/chat';
import { createLiveSkill, liveTopic } from '../skills/live';
import { TEST_ROSTER } from '../testing';
import { parseLiveCard } from './web-format';
import { WebTransport, type WebOutbound } from './web';

describe('live discussion trigger and card', () => {
  it('parses topics from the explicit and natural phrasings', () => {
    expect(liveTopic('@cubbie discuss: how do z-scores work?')).toBe('how do z-scores work?');
    expect(liveTopic('@cubbie start a discussion on regression')).toBe('regression');
    expect(liveTopic('@cubbie start a live discussion about the CLT')).toBe('the CLT');
    expect(liveTopic('@cubbie council B or C?')).toBeNull();
    expect(liveTopic('lets discuss later')).toBeNull();
  });

  it('parseLiveCard strips the footer and returns a live card', () => {
    expect(parseLiveCard('Starting.\n(live discussion ld_abcdefghijkl)')).toEqual({
      text: 'Starting.',
      card: { type: 'live', liveId: 'ld_abcdefghijkl' },
    });
    expect(parseLiveCard('(live discussion nope)')).toBeUndefined();
  });

  it('"@cubbie discuss: ..." starts a run and yields a live card', async () => {
    const out: WebOutbound[] = [];
    const transport = new WebTransport({ onMessage: (o) => void out.push(o) });
    const started: { topic: string; askedBy: string; chatId: string }[] = [];
    const db = openMemoryDb();
    const bot = createBot({
      skills: [
        chatSkill,
        createLiveSkill({
          start: async (i) => {
            started.push(i);
            return { id: 'ld_abcdefghijkl' };
          },
        }),
      ],
      llm: new FakeLlm({ fallback: 'hello' }),
      transport,
      db,
      roster: TEST_ROSTER,
    });
    await bot.start();
    await transport.inject({
      chatId: 'group:sq_demo',
      from: 's_ana',
      text: '@cubbie discuss: z-scores',
    });
    const msg = out.find((o) => o.card?.type === 'live');
    expect(msg?.card).toEqual({ type: 'live', liveId: 'ld_abcdefghijkl' });
    expect(msg?.text).not.toContain('(live discussion');
    expect(started).toEqual([{ topic: 'z-scores', askedBy: 's_ana', chatId: 'group:sq_demo' }]);
  });
});
