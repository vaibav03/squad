import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCouncilService, createCouncilSkill, createDemoCouncilLlm } from '@squad/brain';
import { createBot } from '../bot';
import { chatSkill } from '../skills/chat';
import { TEST_ROSTER } from '../testing';
import { parseCouncilCard } from './web-format';
import { WebTransport, type WebOutbound } from './web';

describe('council card on the web transport', () => {
  it('parseCouncilCard strips the footer and returns a council card', () => {
    expect(parseCouncilCard('Council verdict: B.\n(council run cn_abcdefghijkl)')).toEqual({
      text: 'Council verdict: B.',
      card: { type: 'council', runId: 'cn_abcdefghijkl' },
    });
    expect(parseCouncilCard('no footer here')).toBeUndefined();
    expect(parseCouncilCard('(council run nope)')).toBeUndefined();
  });

  it('"@cubbie council ..." in the group yields a council card, with the verdict still in the text', async () => {
    const out: WebOutbound[] = [];
    const transport = new WebTransport({ onMessage: (o) => void out.push(o) });
    const db = openMemoryDb();
    const council = createCouncilService({
      llm: createDemoCouncilLlm(),
      db,
      emit: () => undefined,
      demo: true,
    });
    const bot = createBot({
      skills: [chatSkill, createCouncilSkill(council)],
      llm: new FakeLlm({ fallback: 'hello' }),
      transport,
      db,
      roster: TEST_ROSTER,
    });
    await bot.start();
    await transport.inject({
      chatId: 'group:sq_demo',
      from: 's_ana',
      text: '@cubbie council B or C?',
    });
    // the run card goes out first, so the board can be opened while the council works
    const msg = out.find((o) => o.card?.type === 'council');
    expect(msg).toBeDefined();
    expect(msg!.chatId).toBe('group:sq_demo');
    expect(msg!.card).toMatchObject({
      type: 'council',
      runId: expect.stringMatching(/^cn_[a-z0-9]{12}$/),
    });
    expect(out.indexOf(msg!)).toBeLessThan(
      out.findIndex((o) => /Council verdict:/.test(o.text ?? '')),
    );
    // the verdict text follows as a plain message, without a footer or a second card
    const verdict = out.find((o) => /Council verdict:/.test(o.text ?? ''));
    expect(verdict).toBeDefined();
    expect(verdict!.card).toBeUndefined();
    expect(verdict!.text).not.toContain('(council run');
    const runId = (msg!.card as { runId: string }).runId;
    expect(council.get(runId)?.status).toBe('done');
  });
});
