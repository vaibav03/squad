import { describe, expect, it } from 'vitest';
import {
  GeminiLive,
  kindFromClose,
  type LiveConnectParams,
  type LiveSessionLike,
} from './gemini-client';
import { LiveClientError, type LiveAgentHandlers } from './types';

function setup() {
  let params!: LiveConnectParams;
  const sent: unknown[] = [];
  let closed = false;
  const session: LiveSessionLike = {
    sendRealtimeInput: (p) => void sent.push(p),
    close: () => void (closed = true),
  };
  const client = new GeminiLive({
    model: 'gemini-3.8-live',
    connectFn: (p) => {
      params = p;
      return Promise.resolve(session);
    },
  });
  const ev: string[] = [];
  const handlers = {
    audio: (p: string) => ev.push(`audio:${p}`),
    outputTranscript: (t: string) => ev.push(`text:${t}`),
    turnComplete: () => ev.push('done'),
    interrupted: () => ev.push('interrupted'),
    error: (k: string) => ev.push(`error:${k}`),
    close: () => ev.push('close'),
  };
  return { client, handlers, ev, sent, p: () => params, closed: () => closed };
}

const opts = (handlers: LiveAgentHandlers) => ({
  persona: 'tutor' as const,
  systemInstruction: 'be the tutor',
  voice: 'Kore',
  handlers,
});

describe('GeminiLive (injected connect, no network)', () => {
  it('connects with the documented config and relays text in / audio + transcript out', async () => {
    const s = setup();
    await s.client.connect(opts(s.handlers));
    expect(s.p().model).toBe('gemini-3.8-live');
    expect(s.p().config).toMatchObject({
      responseModalities: ['AUDIO'],
      systemInstruction: 'be the tutor',
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: {},
    });
    s.client.sendText('hello');
    expect(s.sent).toEqual([{ text: 'hello' }]);
    s.p().callbacks.onmessage({
      serverContent: {
        modelTurn: { parts: [{ inlineData: { data: 'QUJD' } }] },
        outputTranscription: { text: 'Hi there' },
      },
    });
    s.p().callbacks.onmessage({ serverContent: { turnComplete: true } });
    s.p().callbacks.onmessage({ goAway: { timeLeft: '30s' } });
    s.p().callbacks.onmessage({ serverContent: { interrupted: true } });
    expect(s.ev).toEqual(['audio:QUJD', 'text:Hi there', 'done', 'interrupted']);
  });

  it('maps the observed credits close (1011, no onerror) to credits', async () => {
    const s = setup();
    await s.client.connect(opts(s.handlers));
    s.p().callbacks.onclose?.({
      code: 1011,
      reason: 'Your prepayment credits are depleted. Please go to AI Studio ...',
    });
    expect(s.ev).toEqual(['error:credits', 'close']);
  });

  it('maps close reasons and error statuses', async () => {
    expect(kindFromClose('API key not valid')).toBe('auth');
    expect(kindFromClose('Permission denied')).toBe('auth');
    expect(kindFromClose('Quota exceeded')).toBe('rate_limited');
    expect(kindFromClose('RESOURCE_EXHAUSTED')).toBe('rate_limited');
    expect(kindFromClose('Your prepayment credits are depleted')).toBe('credits');
    expect(kindFromClose('internal error')).toBe('unavailable');
    for (const [e, kind] of [
      [Object.assign(new Error('x'), { status: 402 }), 'credits'],
      [Object.assign(new Error('x'), { status: 429 }), 'rate_limited'],
      [Object.assign(new Error('x'), { status: 401 }), 'auth'],
      [new Error('PERMISSION_DENIED'), 'auth'],
    ] as const) {
      const s = setup();
      await s.client.connect(opts(s.handlers));
      s.p().callbacks.onerror?.(e);
      expect(s.ev).toEqual([`error:${kind}`]);
    }
  });

  it('a close we did not ask for is a failure; our own close is not', async () => {
    const s = setup();
    await s.client.connect(opts(s.handlers));
    s.client.close();
    s.p().callbacks.onclose?.({ code: 1000 });
    expect(s.ev).toEqual([]);
    expect(s.closed()).toBe(true);
    const t = setup();
    await t.client.connect(opts(t.handlers));
    t.p().callbacks.onclose?.({ code: 1006 });
    expect(t.ev).toEqual(['error:unavailable', 'close']);
  });

  it('connect failure surfaces a LiveClientError with the mapped kind; no key without injection', async () => {
    const c = new GeminiLive({
      connectFn: () => Promise.reject(Object.assign(new Error('x'), { status: 402 })),
    });
    await expect(c.connect(opts({}))).rejects.toMatchObject({ kind: 'credits' });
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await expect(new GeminiLive().connect(opts({}))).rejects.toBeInstanceOf(LiveClientError);
    if (saved !== undefined) process.env.GEMINI_API_KEY = saved;
  });
});
