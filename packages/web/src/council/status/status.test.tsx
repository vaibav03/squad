// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COUNCIL_KEY_FIX, type CouncilStatus } from '@squad/core';
import { CouncilStatusStrip } from './CouncilStatusStrip';
import { deriveRunBadge, deriveStrip, DEMO_BANNER, type StripRun } from './derive';
import { storedRunFixture } from '../fixtures';

afterEach(cleanup);

const status = (
  o: { key?: CouncilStatus['key']['state']; defaultTransport?: 'stream' | 'live' } = {},
): CouncilStatus => ({
  provider: 'Google Gemini',
  generatedAt: 1,
  key: { state: o.key ?? 'ok', fix: COUNCIL_KEY_FIX[o.key ?? 'ok'] },
  defaultTransport: 'stream',
  models: {
    fast: 'gemini-3.5-flash-lite',
    main: 'gemini-3.8-flash',
    chair: 'gemini-3.8-flash',
    live: 'gemini-3.8-live',
  },
  transports: {
    stream: { available: true, label: 'Gemini streaming text' },
    live: { enabled: true, state: 'untested', label: 'Gemini Live (not tried yet)' },
  },
  demo: { forced: false },
  a2a: { runs: 2, messages: 17, delegations: 4, activeRuns: 0, lastStage: 'verdict' },
  ...(o.defaultTransport ? { defaultTransport: o.defaultTransport } : {}),
});

const live: StripRun = {
  mode: 'live',
  transport: {
    kind: 'stream-text',
    label: 'Gemini streaming text',
    models: [{ who: 'chair', model: 'gemini-3.8-flash' }],
  },
  agents: [{ mode: 'live' }, { mode: 'live' }],
  counters: { messages: 9, delegations: 2, stage: 'opinions' },
};

describe('deriveRunBadge', () => {
  it('LIVE only when the run and every participant are live and the transport is real', () => {
    expect(deriveRunBadge(live, status())).toMatchObject({ tier: 'live', text: 'LIVE: Gemini' });
    expect(deriveRunBadge({ ...live, agents: undefined }, status()).tier).toBe('live');
  });
  it('one degraded participant makes it DEGRADED with the reason in words', () => {
    const b = deriveRunBadge(
      { ...live, agents: [{ mode: 'live' }, { mode: 'degraded:rate_limited' }] },
      status(),
    );
    expect(b).toMatchObject({ tier: 'degraded', text: 'DEGRADED: rate limited' });
    expect(deriveRunBadge({ ...live, mode: 'degraded:credits_depleted' }, status()).text).toBe(
      'DEGRADED: credits depleted',
    );
  });
  it('anything demo is DEMO, and demo beats degraded', () => {
    for (const run of [
      { ...live, mode: 'demo' },
      { ...live, mode: 'demo:no_key' },
      { ...live, transport: { kind: 'demo' as const, label: 'Demo (scripted, not Gemini)' } },
      { ...live, agents: [{ mode: 'live' }, { mode: 'demo' }] },
      { ...live, mode: 'degraded:timeout', agents: [{ mode: 'demo' }] },
    ])
      expect(deriveRunBadge(run, status()).text).toBe(DEMO_BANNER);
  });
  it('a hub with no key is DEMO even before any run, and for a non-live run', () => {
    expect(deriveRunBadge(undefined, status({ key: 'no_key' })).text).toBe(DEMO_BANNER);
    expect(deriveRunBadge({ ...live, mode: 'degraded:x_y' }, status({ key: 'no_key' })).text).toBe(
      DEMO_BANNER,
    );
  });
  it('no run and a working key shows no badge; fixtures without a hub follow the run', () => {
    expect(deriveRunBadge(undefined, status()).tier).toBe('none');
    expect(deriveRunBadge(undefined, null).tier).toBe('none');
    expect(deriveRunBadge({ ...live, mode: 'demo' }, null).text).toBe(DEMO_BANNER);
    expect(deriveRunBadge(live, 'unknown').tier).toBe('live');
  });
});

describe('deriveStrip', () => {
  it('uses the models the run reports, else the hub configuration', () => {
    expect(deriveStrip({ status: status(), run: live }).models).toEqual([
      { who: 'chair', model: 'gemini-3.8-flash' },
    ]);
    const cfg = deriveStrip({ status: status(), run: { ...live, transport: undefined } });
    expect(cfg.models.map((m) => m.who)).toEqual(['chair', 'main', 'fast']);
    expect(deriveStrip({ status: status(), run: { ...live, mode: 'demo' } }).models).toEqual([]);
  });
  it('transport words for every case', () => {
    expect(deriveStrip({ status: status(), run: live }).transport).toBe('Gemini streaming text');
    const liveAudio = {
      ...live,
      transport: { kind: 'live-audio' as const, label: 'Gemini Live (audio + transcript)' },
    };
    expect(deriveStrip({ status: status(), run: liveAudio }).transport).toBe(
      'Gemini Live (audio + transcript)',
    );
    const fb = {
      ...live,
      transport: {
        kind: 'stream-text' as const,
        label: 'Gemini streaming (Live unavailable: credits depleted)',
        requested: 'live' as const,
        why: 'credits_depleted',
      },
    };
    const v = deriveStrip({ status: status(), run: fb });
    expect(v.transport).toBe('Gemini streaming (Live unavailable: credits depleted)');
    expect(v.fallback).toBe('Live was requested but not used: credits depleted');
    expect(deriveStrip({ status: status(), run: { ...live, mode: 'demo' } }).transport).toBe(
      'Demo (scripted, not Gemini)',
    );
    expect(deriveStrip({ status: status() }).transport).toBe('Gemini streaming text');
    expect(deriveStrip({ status: status({ defaultTransport: 'live' }) }).transport).toBe(
      'Gemini Live (not tried yet)',
    );
    expect(deriveStrip({ status: null }).transport).toBe('Transport unknown');
  });
  it('mic, audio and transcript default honestly and can be set', () => {
    const lv = { ...live, transport: { kind: 'live-audio' as const, label: 'x' } };
    expect(deriveStrip({ status: status(), run: lv })).toMatchObject({
      mic: 'idle',
      audio: 'muted',
      transcript: 'streaming',
    });
    expect(deriveStrip({ status: status(), run: live })).toMatchObject({
      mic: 'unavailable',
      audio: 'unavailable',
      transcript: 'none',
    });
    expect(
      deriveStrip({
        status: status(),
        run: lv,
        mic: 'permission_denied',
        audio: 'playing',
        transcript: 'complete',
      }),
    ).toMatchObject({ mic: 'permission_denied', audio: 'playing', transcript: 'complete' });
  });
  it('key state words and the fix come from the hub; unknown without it', () => {
    for (const k of ['ok', 'credits_depleted', 'no_key', 'rate_limited'] as const) {
      const v = deriveStrip({ status: status({ key: k }) });
      expect(v.key.state).toBe(k);
      expect(v.key.fix).toBe(COUNCIL_KEY_FIX[k]);
    }
    expect(deriveStrip({ status: 'unknown' }).key.state).toBe('unknown');
  });
  it('A2A counters come from the run, else from the hub totals', () => {
    expect(deriveStrip({ status: status(), run: live }).counters).toEqual({
      messages: 9,
      delegations: 2,
      stage: 'Opinions',
    });
    expect(deriveStrip({ status: status() }).counters).toEqual({
      messages: 17,
      delegations: 4,
      stage: 'Verdict',
    });
  });
});

describe('CouncilStatusStrip', () => {
  const text = (id: string) => screen.getByTestId(id).textContent ?? '';
  it('live: banner, provider, transport, models, key, mode, mic/audio/transcript and counters', () => {
    render(<CouncilStatusStrip status={status()} run={live} variant="full" />);
    expect(text('cs-banner')).toContain('LIVE: Gemini');
    expect(text('cs-provider')).toContain('Google Gemini');
    expect(text('cs-transport')).toContain('Gemini streaming text');
    expect(text('cs-models')).toContain('chair gemini-3.8-flash');
    expect(text('cs-key')).toContain('Key ok');
    expect(text('cs-mode')).toContain('Live');
    expect(text('cs-mic')).toContain('Mic unavailable');
    expect(text('cs-audio')).toContain('Audio unavailable');
    expect(text('cs-transcript')).toContain('No transcript');
    expect(text('cs-a2a')).toContain('9 messages, 2 delegations, stage: Opinions');
    expect(text('cs-fix')).toContain(COUNCIL_KEY_FIX.ok);
    expect(screen.getByTestId('cs-banner').getAttribute('role')).toBe('status');
  });
  it('demo: an unmissable banner with a glyph, and no models claimed', () => {
    render(
      <CouncilStatusStrip
        status={status({ key: 'no_key' })}
        run={{ ...live, mode: 'demo:no_key' }}
      />,
    );
    expect(text('cs-banner')).toContain('DEMO: scripted, not Gemini');
    expect(text('cs-banner')).toContain('◆');
    expect(text('cs-models')).toContain('No model used (scripted)');
    expect(text('cs-key')).toContain('No key');
    expect(text('cs-fix')).toContain('GEMINI_API_KEY');
  });
  it('degraded: the reason in words, the fix when the key is the cause', () => {
    render(
      <CouncilStatusStrip
        status={status({ key: 'credits_depleted' })}
        run={{ ...live, agents: [{ mode: 'degraded:credits_depleted' }] }}
      />,
    );
    expect(text('cs-banner')).toContain('DEGRADED: credits depleted');
    expect(text('cs-key')).toContain('Credits depleted');
    expect(text('cs-fix')).toContain('prepayment credits');
  });
  it('every mic, audio and transcript state has words and a glyph', () => {
    const cases: Array<['mic' | 'audio' | 'transcript', string, string]> = [
      ['mic', 'idle', 'Mic idle'],
      ['mic', 'listening', 'Mic listening'],
      ['mic', 'permission_denied', 'Mic permission denied'],
      ['mic', 'unavailable', 'Mic unavailable'],
      ['audio', 'playing', 'Audio playing'],
      ['audio', 'muted', 'Audio muted'],
      ['audio', 'unavailable', 'Audio unavailable'],
      ['transcript', 'streaming', 'Transcript streaming'],
      ['transcript', 'complete', 'Transcript complete'],
      ['transcript', 'none', 'No transcript'],
    ];
    for (const [k, v, w] of cases) {
      cleanup();
      render(<CouncilStatusStrip status={status()} run={live} {...{ [k]: v }} />);
      const li = screen.getByTestId(`cs-${k}`);
      expect(li.textContent).toContain(w);
      expect(li.querySelector('[aria-hidden="true"]')?.textContent).toBeTruthy();
    }
  });
  it('rate limited and the Live fallback are said in words', () => {
    render(
      <CouncilStatusStrip
        status={status({ key: 'rate_limited' })}
        run={{
          ...live,
          transport: {
            kind: 'stream-text',
            label: 'Gemini streaming (Live unavailable: 1011)',
            requested: 'live',
            why: 'live_1011',
          },
        }}
      />,
    );
    expect(text('cs-key')).toContain('Rate limited');
    expect(text('cs-fallback')).toContain('Live was requested but not used: live 1011');
    expect(text('cs-transport')).toContain('Live unavailable');
  });
  it('a stored demo run (fixture) shows the banner with no hub at all', () => {
    const r = storedRunFixture({ mode: 'demo', kind: 'demo' });
    render(
      <CouncilStatusStrip
        status={null}
        run={{
          mode: r.mode,
          transport: r.transport,
          agents: r.agents,
          counters: {
            messages: r.counters.messages,
            delegations: r.counters.delegations,
            stage: r.stage,
          },
        }}
      />,
    );
    expect(text('cs-banner')).toContain(DEMO_BANNER);
    expect(text('cs-key')).toContain('Key state unknown');
  });
  it('renders nothing banner-like for an idle hub with a working key', () => {
    render(<CouncilStatusStrip status={status()} />);
    expect(screen.queryByTestId('cs-banner')).toBeNull();
    expect(text('cs-a2a')).toContain('17 messages');
  });
});
