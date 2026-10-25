import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeLlm, RecordingLlm } from './index';
import { DEFAULT_GEMINI_MODELS, GeminiLlm } from './node';

describe('FakeLlm', () => {
  it('returns queued text, then the default; records calls', async () => {
    const llm = new FakeLlm({ responses: ['one'] });
    expect((await llm.complete({ messages: 'hi' })).text).toBe('one');
    expect((await llm.complete({ messages: 'hi' })).text).toBe('fake response');
    expect(llm.calls).toHaveLength(2);
  });

  it('validates structured JSON with zod', async () => {
    const schema = z.object({ n: z.number() });
    const llm = new FakeLlm({ responses: [{ n: 1 }, '{"n":2}', { n: 'x' }] });
    expect(await llm.json({ messages: 'a', schema })).toEqual({ n: 1 });
    expect(await llm.json({ messages: 'a', schema })).toEqual({ n: 2 });
    await expect(llm.json({ messages: 'a', schema })).rejects.toThrow();
    await expect(new FakeLlm().json({ messages: 'a', schema })).rejects.toThrow(/no queued/);
  });

  it('accepts vision parts and runs tools', async () => {
    const execute = vi.fn(async ({ x }: { x: number }) => x * 2);
    const llm = new FakeLlm({
      responses: [
        { text: '', toolCalls: [{ id: '1', name: 'dbl', args: { x: 4 } }] },
        'result is 8',
      ],
    });
    const r = await llm.complete({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see' },
            { type: 'image', mimeType: 'image/png', data: 'AAAA' },
          ],
        },
      ],
      tools: [
        { name: 'dbl', description: 'double', parameters: z.object({ x: z.number() }), execute },
      ],
    });
    expect(execute).toHaveBeenCalledWith({ x: 4 });
    expect(r.text).toBe('result is 8');
  });

  it('returns unexecuted tool calls to the caller', async () => {
    const llm = new FakeLlm({ responses: [{ toolCalls: [{ id: '1', name: 'noop', args: {} }] }] });
    const r = await llm.complete({
      messages: 'x',
      tools: [{ name: 'noop', description: '', parameters: z.object({}) }],
    });
    expect(r.toolCalls[0]?.name).toBe('noop');
  });

  it('creates cache handles and replays recordings', async () => {
    const llm = new FakeLlm();
    const h = await llm.createCache({ system: 'big chapter' });
    expect(h.provider).toBe('fake');
    const rec = new RecordingLlm(new FakeLlm({ responses: ['recorded'] }));
    await rec.complete({ messages: 'q', cache: h });
    const replay = FakeLlm.fromRecording(rec.entries);
    expect((await replay.complete({ messages: 'q', cache: h })).text).toBe('recorded');
  });
});

describe('GeminiLlm (no network)', () => {
  it('requires an api key unless a client is injected', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => new GeminiLlm()).toThrow(/GEMINI_API_KEY/);
    vi.unstubAllEnvs();
  });

  it('maps tiers and request shape using an injected client', async () => {
    const generateContent = vi.fn(async () => ({
      text: '{"ok":true}',
      functionCalls: undefined,
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, cachedContentTokenCount: 1 },
    }));
    const create = vi.fn(async () => ({ name: 'cachedContents/abc' }));
    const llm = new GeminiLlm({
      client: { models: { generateContent }, caches: { create } } as any,
      models: { fast: 'f-model' },
    });
    expect(llm.resolveModel('fast')).toBe('f-model');
    expect(llm.resolveModel('custom-x')).toBe('custom-x');
    const r = await llm.complete({
      model: 'fast',
      system: 'sys',
      messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AA' }] }],
    });
    expect(r.usage).toEqual({ inputTokens: 3, outputTokens: 2, cachedTokens: 1 });
    const call = (generateContent.mock.calls[0] as any)[0];
    expect(call.model).toBe('f-model');
    expect(call.config.systemInstruction).toBe('sys');
    expect(call.contents[0].parts[0].inlineData.data).toBe('AA');
    expect(await llm.json({ messages: 'x', schema: z.object({ ok: z.boolean() }) })).toEqual({
      ok: true,
    });
    const h = await llm.createCache({ system: 's', ttlSeconds: 60 });
    expect(h).toMatchObject({ id: 'cachedContents/abc', provider: 'gemini' });
  });

  it('defaults to the documented model ids', () => {
    expect(DEFAULT_GEMINI_MODELS).toEqual({
      fast: 'gemini-3.5-flash-lite',
      main: 'gemini-3.8-flash',
      chair: 'gemini-3.8-flash',
    });
  });

  it('json(): responseMimeType + responseJsonSchema, parses response.text', async () => {
    const generateContent = vi.fn(async () => ({ text: '{"n":2}' }));
    const llm = new GeminiLlm({ client: { models: { generateContent }, caches: {} } as any });
    const out = await llm.json({
      model: 'fast',
      system: 'sys',
      messages: 'q',
      schema: z.object({ n: z.number() }),
      temperature: 0,
      maxTokens: 50,
    });
    expect(out).toEqual({ n: 2 });
    const call = (generateContent.mock.calls[0] as any)[0];
    expect(call.model).toBe('gemini-3.5-flash-lite');
    expect(call.contents).toEqual([{ role: 'user', parts: [{ text: 'q' }] }]);
    expect(call.config).toMatchObject({
      systemInstruction: 'sys',
      temperature: 0,
      maxOutputTokens: 50,
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object', properties: { n: { type: 'number' } } },
    });
    expect(call.config.responseSchema).toBeUndefined();
  });

  it('cache: caches.create shape, expireTime from response, cachedContent replaces systemInstruction, delete by name', async () => {
    const generateContent = vi.fn(async () => ({ text: 'ok' }));
    const create = vi.fn(async () => ({
      name: 'cachedContents/xyz',
      expireTime: '2030-01-01T00:00:00Z',
    }));
    const del = vi.fn(async () => ({}));
    const llm = new GeminiLlm({
      client: { models: { generateContent }, caches: { create, delete: del } } as any,
    });
    const h = await llm.createCache({ model: 'main', system: 'big', ttlSeconds: 1800 });
    expect(create).toHaveBeenCalledWith({
      model: 'gemini-3.8-flash',
      config: { ttl: '1800s', systemInstruction: 'big' },
    });
    expect(h).toEqual({
      id: 'cachedContents/xyz',
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      expiresAt: Date.parse('2030-01-01T00:00:00Z'),
    });
    await llm.complete({ system: 'big', cache: h, messages: 'q' });
    const cfg = (generateContent.mock.calls[0] as any)[0].config;
    expect(cfg.cachedContent).toBe('cachedContents/xyz');
    expect(cfg.systemInstruction).toBeUndefined();
    await llm.deleteCache(h);
    expect(del).toHaveBeenCalledWith({ name: 'cachedContents/xyz' });
  });

  it('tool loop echoes the Gemini 3 thoughtSignature on the replayed functionCall part', async () => {
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce({
        text: undefined,
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: { id: 'c1', name: 'add', args: { a: 1 } },
                  thoughtSignature: 'SIG',
                },
                { functionCall: { id: 'c2', name: 'add', args: { a: 2 } } },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({ text: 'done' });
    const llm = new GeminiLlm({ client: { models: { generateContent }, caches: {} } as any });
    const r = await llm.complete({
      messages: 'go',
      tools: [
        {
          name: 'add',
          description: 'adds',
          parameters: z.object({ a: z.number() }),
          execute: ({ a }: { a: number }) => a + 1,
        },
      ],
    });
    expect(r.text).toBe('done');
    const first = (generateContent.mock.calls[0] as any)[0];
    expect(first.config.tools[0].functionDeclarations[0]).toMatchObject({
      name: 'add',
      description: 'adds',
      parametersJsonSchema: { type: 'object' },
    });
    const second = (generateContent.mock.calls[1] as any)[0];
    expect(second.contents[1]).toEqual({
      role: 'model',
      parts: [
        { functionCall: { id: 'c1', name: 'add', args: { a: 1 } }, thoughtSignature: 'SIG' },
        { functionCall: { id: 'c2', name: 'add', args: { a: 2 } } },
      ],
    });
    expect(second.contents[2]).toEqual({
      role: 'user',
      parts: [
        { functionResponse: { id: 'c1', name: 'add', response: { output: 2 } } },
        { functionResponse: { id: 'c2', name: 'add', response: { output: 3 } } },
      ],
    });
  });
});
