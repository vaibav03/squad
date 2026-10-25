import { describe, expect, it } from 'vitest';
import { VoicesUnavailableError } from '@squad/core';
import { MemoryVoiceStore } from '../voices/store';
import { TtsHealth, classifyTtsError, type TtsProbeEngine } from './health';
import { TtsHttpError } from './types';

const STOCK = 'stock_voice';
const restricted = () =>
  new TtsHttpError(
    401,
    '{"detail":{"status":"missing_permissions","message":"The API key is missing the permission text_to_speech"}}',
  );
const paid = () =>
  new TtsHttpError(
    402,
    '{"detail":{"status":"paid_plan_required","message":"Free users cannot use library voices via the API."}}',
  );
const noVoicesRead = () =>
  new TtsHttpError(401, '{"detail":{"status":"missing_permissions","message":"voices_read"}}');

/** Injected client: records every call so tests can assert the character spend. */
function fake(o: {
  synth?: (voiceId: string) => void; // throw to fail
  list?: () => { id: string; name: string }[];
  design?: () => { generatedVoiceId: string }[];
  save?: () => string;
}) {
  const calls: string[] = [];
  let chars = 0;
  const engine: TtsProbeEngine = {
    async synth(r) {
      calls.push(`synth:${r.voiceId}`);
      chars += r.text.length;
      o.synth?.(r.voiceId);
      return {};
    },
    async listVoices() {
      calls.push('list');
      if (!o.list) throw noVoicesRead();
      return o.list();
    },
    async designVoice() {
      calls.push('design');
      if (!o.design) throw noVoicesRead();
      return o.design();
    },
    async saveVoice() {
      calls.push('save');
      return o.save?.() ?? 'designed_1';
    },
  };
  return { engine, calls, chars: () => chars };
}
const make = (engine: TtsProbeEngine | undefined, extra: Record<string, unknown> = {}) => {
  let t = 1000;
  const store = new MemoryVoiceStore();
  const h = new TtsHealth({
    ...(engine ? { engine } : {}),
    store,
    stockVoiceId: STOCK,
    now: () => t,
    ...extra,
  });
  return { h, store, tick: (ms: number) => (t += ms) };
};

describe('classifyTtsError', () => {
  it('maps ElevenLabs failures to what they mean for speech', () => {
    expect(classifyTtsError(restricted())).toBe('key_restricted');
    expect(classifyTtsError(paid())).toBe('paid_plan_required');
    expect(classifyTtsError(new TtsHttpError(429, ''))).toBe('rate_limited');
    expect(classifyTtsError(new TtsHttpError(401, '{"detail":{"status":"quota_exceeded"}}'))).toBe(
      'rate_limited',
    );
    expect(classifyTtsError(new TtsHttpError(404, 'voice_not_found'))).toBe('voice');
    expect(classifyTtsError(new Error('fetch failed'))).toBe('unavailable');
  });
});

describe('TtsHealth', () => {
  it('no key: none / no_key and nothing is called', async () => {
    const { h } = make(undefined);
    expect(h.status()).toMatchObject({ tts: 'none', reason: 'no_key', probing: false });
    await expect(h.gate()).rejects.toBeInstanceOf(VoicesUnavailableError);
  });

  it('restricted key: key_restricted after ONE character, no further candidates tried', async () => {
    const f = fake({
      synth: () => {
        throw restricted();
      },
    });
    const { h } = make(f.engine);
    expect(h.status()).toMatchObject({ probing: true }); // first status starts the probe, claims nothing
    await h.start();
    expect(h.status()).toMatchObject({ tts: 'none', reason: 'key_restricted', probing: false });
    expect(f.chars()).toBeLessThanOrEqual(1);
    expect(f.calls.filter((c) => c.startsWith('synth'))).toHaveLength(1);
  });

  it('free plan: library voice 402 -> paid_plan_required, with design and list skipped for lack of permission', async () => {
    const f = fake({
      synth: () => {
        throw paid();
      },
    });
    const { h } = make(f.engine);
    await h.start();
    expect(h.status()).toMatchObject({ tts: 'none', reason: 'paid_plan_required' });
    expect(f.calls).toEqual(['design', 'list', `synth:${STOCK}`]);
    expect(f.chars()).toBe(1);
    await expect(h.gate()).rejects.toMatchObject({
      reason: 'paid_plan_required',
      message: 'Voices need an ElevenLabs plan that allows API voices',
    });
  });

  it('a saved (user-owned) voice is tried first and wins without design or the stock voice', async () => {
    const f = fake({
      synth: (v) => {
        if (v === STOCK) throw paid();
      },
    });
    const { h, store } = make(f.engine);
    store.set('buddy', 'mine_1');
    await h.start();
    expect(h.status()).toMatchObject({ tts: 'elevenlabs', reason: 'ok' });
    expect(h.voiceId()).toBe('mine_1');
    expect(f.calls).toEqual(['synth:mine_1']);
  });

  it('voice design then save is used when permitted, and the id is persisted for next time', async () => {
    const f = fake({
      synth: (v) => {
        if (v === STOCK) throw paid();
      },
      design: () => [{ generatedVoiceId: 'g1' }],
      save: () => 'designed_9',
    });
    const { h, store } = make(f.engine);
    await h.start();
    expect(h.voiceId()).toBe('designed_9');
    expect(store.get('squad-default')).toBe('designed_9');
    expect(f.calls).toEqual(['design', 'save', 'synth:designed_9']);
  });

  it('design is skipped when allowDesign is false (doctor)', async () => {
    const f = fake({ synth: () => undefined, design: () => [{ generatedVoiceId: 'g1' }] });
    const { h } = make(f.engine, { allowDesign: false });
    await h.start();
    expect(f.calls).not.toContain('design');
    expect(h.voiceId()).toBe(STOCK);
  });

  it('the account listed voices are tried when voices_read exists', async () => {
    const f = fake({
      synth: (v) => {
        if (v === STOCK || v === 'lib') throw paid();
      },
      list: () => [
        { id: 'lib', name: 'Library' },
        { id: 'own_1', name: 'Own' },
      ],
    });
    const { h } = make(f.engine);
    await h.start();
    expect(h.voiceId()).toBe('own_1');
    expect(f.chars()).toBe(2);
  });

  it('rate limited: reason rate_limited, stops after one character', async () => {
    const f = fake({
      synth: () => {
        throw new TtsHttpError(429, 'too many');
      },
    });
    const { h } = make(f.engine);
    await h.start();
    expect(h.status().reason).toBe('rate_limited');
    expect(f.chars()).toBe(1);
  });

  it('re-probes only after 10 minutes, in the background, and recovers', async () => {
    let paidPlan = false;
    const f = fake({
      synth: () => {
        if (!paidPlan) throw paid();
      },
    });
    const { h, tick } = make(f.engine);
    await h.start();
    expect(h.status().reason).toBe('paid_plan_required');
    const n = f.calls.length;
    tick(9 * 60_000);
    h.status();
    await h.ready();
    expect(f.calls.length).toBe(n); // not yet
    paidPlan = true;
    tick(2 * 60_000);
    h.status(); // schedules the re-probe; the answer returned is still the cached one
    await h.ready();
    expect(h.status()).toMatchObject({ tts: 'elevenlabs', reason: 'ok' });
    expect(h.voiceId()).toBe(STOCK);
  });

  it('start does not block: status is immediate and says probing while a probe hangs, then times out', async () => {
    const engine: TtsProbeEngine = { synth: () => new Promise(() => undefined) };
    const { h } = make(engine, { timeoutMs: 30 });
    const t0 = Date.now();
    const s = h.status();
    expect(Date.now() - t0).toBeLessThan(20);
    expect(s).toMatchObject({ tts: 'none', probing: true });
    await h.ready();
    expect(h.status()).toMatchObject({ probing: false, reason: 'unavailable' });
  });
});
