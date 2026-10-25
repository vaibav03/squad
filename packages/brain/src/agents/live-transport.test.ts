import { describe, expect, it } from 'vitest';
import { degradedReason } from './mode';
import {
  createLiveTextTransport,
  type LiveConnectParamsLike,
  type LiveMessageLike,
  type LiveSocketLike,
} from './live-transport';
import { toolsFor } from './tools';
import type { AgentSpec } from './types';

const spec: AgentSpec = {
  id: 'council:ask-skeptic' as AgentSpec['id'],
  key: 'skeptic',
  role: 'specialist',
  displayName: 'Skeptic',
  stance: 's',
  system: 'sys',
  tools: ['retrieve_course'],
  tier: 'main',
};

function fake() {
  const sent: unknown[] = [];
  let params!: LiveConnectParamsLike;
  let closed = false;
  const socket: LiveSocketLike = {
    sendRealtimeInput: (p) => void sent.push({ in: p }),
    sendToolResponse: (p) => void sent.push({ tool: p }),
    close: () => void (closed = true),
  };
  const t = createLiveTextTransport({
    connect: async (p) => {
      params = p;
      return socket;
    },
  });
  const session = t.open({
    spec,
    system: 'sys',
    tools: toolsFor(['retrieve_course']),
    children: [],
    maxOutputTokens: 100,
  });
  const push = (m: LiveMessageLike) => params.callbacks.onmessage(m);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { session, sent, push, tick, params: () => params, isClosed: () => closed, t };
}

describe('live-text transport', () => {
  it('declares tools, TEXT modality, and round-trips a tool call', async () => {
    const f = fake();
    const p = f.session.send('hi');
    await f.tick();
    expect(f.t.kind).toBe('live-text');
    expect(f.params().config.responseModalities).toEqual(['TEXT']);
    const decls = (
      f.params().config.tools as { functionDeclarations: { name: string }[] }[]
    )[0]!.functionDeclarations.map((d) => d.name);
    expect(decls).toEqual(expect.arrayContaining(['retrieve_course', 'submit_turn']));
    f.push({
      toolCall: { functionCalls: [{ id: 'c1', name: 'retrieve_course', args: { query: 'x' } }] },
      usageMetadata: { promptTokenCount: 10, responseTokenCount: 4 },
    });
    const r = await p;
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'retrieve_course', args: { query: 'x' } }]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 4 });
    const p2 = f.session.send([{ id: 'c1', name: 'retrieve_course', result: { ok: 1 } }]);
    await f.tick();
    f.push({ serverContent: { modelTurn: { parts: [{ text: 'done' }] }, turnComplete: true } });
    expect((await p2).text).toBe('done');
    expect(JSON.stringify(f.sent[1])).toContain('functionResponses');
  });

  it('drops thought parts and signatures', async () => {
    const f = fake();
    const p = f.session.send('hi');
    await f.tick();
    f.push({
      serverContent: {
        modelTurn: {
          parts: [
            { text: 'SENTINEL_THINKING', thought: true },
            { text: 'visible', thoughtSignature: 'SENTINEL_SIG' },
          ],
        },
        turnComplete: true,
      },
    });
    const r = await p;
    expect(JSON.stringify(r)).not.toContain('SENTINEL');
    expect(r.text).toBe('visible');
  });

  it('maps a 1011 credits close and a quota close to degraded reasons', async () => {
    const f = fake();
    const p = f.session.send('hi');
    await f.tick();
    f.params().callbacks.onclose?.({ code: 1011, reason: 'Your prepayment credits are depleted' });
    await expect(p).rejects.toSatisfy((e) => degradedReason(e) === 'credits_depleted');
    const g = fake();
    const q = g.session.send('hi');
    await g.tick();
    g.params().callbacks.onclose?.({ code: 1011 });
    await expect(q).rejects.toSatisfy((e) => degradedReason(e) === 'session_closed');
    const h = fake();
    const w = h.session.send('hi');
    await h.tick();
    h.params().callbacks.onclose?.({ code: 1008, reason: 'quota exceeded' });
    await expect(w).rejects.toSatisfy((e) => degradedReason(e) === 'rate_limited');
  });

  it('aborts a waiting step and closes the socket on close()', async () => {
    const f = fake();
    const ac = new AbortController();
    const p = f.session.send('hi', { signal: ac.signal });
    await f.tick();
    ac.abort();
    await expect(p).rejects.toSatisfy((e) => degradedReason(e) === 'timeout');
    f.session.close();
    expect(f.isClosed()).toBe(true);
    await expect(f.session.send('again')).rejects.toSatisfy(
      (e) => degradedReason(e) === 'session_closed',
    );
  });
});
