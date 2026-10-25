import { dropThoughtParts, visibleText } from '@squad/core';
import { GeminiLlm } from '@squad/core/node';
import type { Llm } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { FakeTransport, call, idOf, makeHarness, step, submit } from './test-kit';
import { createStreamTextTransport } from './stream-transport';
import type { CallOptions } from './types';

const SENTINEL = 'SENTINEL_THOUGHT_7f3';
const SIG = 'SIGNATURE_OPAQUE_9c1';
const opinion: CallOptions = {
  kind: 'answer',
  stage: 'opinions',
  to: idOf('chair') as never,
  depth: 1,
  prompt: 'q',
};

describe('no private chain of thought reaches any stream', () => {
  it('discards step text, extra submit_turn fields and signatures', async () => {
    const real = new FakeTransport();
    real.script(idOf('alpha'), {
      text: `${SENTINEL} I should think step by step`,
      toolCalls: [
        {
          ...call('submit_turn', {
            summary: 'Pick A.',
            stance: 'A',
            answer: 'A',
            thought: SENTINEL,
            reasoning: SENTINEL,
            scratchpad: SENTINEL,
          }),
          signature: SIG,
        },
      ],
    });
    const h = makeHarness({ real });
    const t = await h.run.callAgent(h.specs.alpha!, opinion);
    expect(t.status).toBe('done');
    const everything = JSON.stringify([h.events, h.run.messages(), t, h.run.agents()]);
    expect(everything).not.toContain(SENTINEL);
    expect(everything).not.toContain(SIG);
  });

  it('text alongside a tool round never leaks either', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('alpha'),
      { text: SENTINEL, toolCalls: [call('retrieve_course', { query: 'x' })] },
      { text: SENTINEL, toolCalls: [] },
      { text: SENTINEL, toolCalls: [] },
    );
    const h = makeHarness({
      real,
      ports: { retrieve: async () => ({ grounded: false, quotes: [], pages: [] }) },
    });
    const t = await h.run.callAgent(h.specs.alpha!, opinion);
    expect(t.status).toBe('failed');
    expect(JSON.stringify([h.events, h.run.messages(), t])).not.toContain(SENTINEL);
  });

  it('the stream-text transport path: model text is dropped by the runtime', async () => {
    const llm: Llm = {
      complete: async () => ({
        text: `${SENTINEL} visible-looking prose`,
        toolCalls: [call('submit_turn', { summary: 'Pick A.', stance: 'A', answer: 'A' })],
      }),
      json: async () => {
        throw new Error('unused');
      },
      createCache: async () => {
        throw new Error('unused');
      },
    };
    const h = makeHarness({ real: createStreamTextTransport(llm) as unknown as FakeTransport });
    const t = await h.run.callAgent(h.specs.alpha!, opinion);
    expect(t.status).toBe('done');
    expect(JSON.stringify([h.events, h.run.messages()])).not.toContain(SENTINEL);
  });

  it('tool results from specialists to the chair carry only the public turn', async () => {
    const real = new FakeTransport();
    real.script(
      idOf('chair'),
      step(call('delegate', { to: 'alpha', question: 'q', why: 'w' })),
      submit({ summary: 'ok', stance: 's' }),
    );
    real.script(idOf('alpha'), {
      text: SENTINEL,
      toolCalls: [
        call('submit_turn', { summary: 'Pick A.', stance: 'A', answer: 'A', thought: SENTINEL }),
      ],
    });
    const h = makeHarness({ real });
    await h.run.callAgent(h.specs.chair!, {
      kind: 'status',
      stage: 'delegation',
      to: 'room',
      depth: 0,
      prompt: 'p',
    });
    expect(JSON.stringify(real.inputsOf(idOf('chair')))).not.toContain(SENTINEL);
  });
});

describe('Gemini adapter drops thinking parts', () => {
  const client = (parts: unknown[]) =>
    ({
      models: {
        generateContent: async () => ({
          candidates: [{ content: { parts } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
        }),
      },
      caches: {},
    }) as never;
  const parts = [
    { text: `${SENTINEL} planning the answer`, thought: true },
    { text: 'visible', thoughtSignature: 'TEXT_SIG_SHOULD_NOT_SURFACE' },
    {
      functionCall: { name: 'submit_turn', args: { summary: 's', stance: 'x' }, id: 'f1' },
      thoughtSignature: SIG,
    },
    { text: `${SENTINEL} more thinking`, thought: true, thoughtSignature: 'T2' },
  ];

  it('complete(): thought text never appears; the opaque signature rides only on the tool call', async () => {
    const llm = new GeminiLlm({ client: client(parts), apiKey: 'k' });
    const res = await llm.complete({ messages: 'hi' });
    expect(res.text).toBe('visible');
    expect(JSON.stringify(res)).not.toContain(SENTINEL);
    expect(JSON.stringify(res)).not.toContain('TEXT_SIG_SHOULD_NOT_SURFACE');
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.signature).toBe(SIG);
  });

  it('json(): a thinking part before the JSON does not break or leak', async () => {
    const llm = new GeminiLlm({
      client: client([{ text: `${SENTINEL}`, thought: true }, { text: '{"ok":true}' }]),
      apiKey: 'k',
    });
    const { z } = await import('zod');
    expect(await llm.json({ messages: 'x', schema: z.object({ ok: z.boolean() }) })).toEqual({
      ok: true,
    });
  });

  it('dropThoughtParts / visibleText helpers', () => {
    expect(dropThoughtParts([{ text: 'a', thought: true }, { text: 'b' }])).toEqual([
      { text: 'b' },
    ]);
    expect(dropThoughtParts(undefined)).toEqual([]);
    expect(visibleText([{ text: 'x', thought: true }, { text: 'y' }, { text: 'z' }])).toBe('yz');
  });
});
