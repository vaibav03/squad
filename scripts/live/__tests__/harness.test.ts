import { describe, expect, it } from 'vitest';
import { runVerify } from '../lib/core';
import { Budget, limitsFromEnv } from '../lib/budget';
import { makeRedactor, parseDotEnv } from '../lib/env';
import { renderMarkdown } from '../lib/report';
import { percentiles } from '../lib/meter';
import { baseEnv, FAKE_SECRET, scriptedClient, spendCheck } from './helpers';

const noSleep = async () => undefined;

describe('402 credits depleted', () => {
  it('stops after exactly one probe call, with the exact fix, and skips the rest', async () => {
    const sc = scriptedClient([{ status: 402 }]);
    const { report } = await runVerify({
      env: baseEnv(),
      checks: [spendCheck(1, 3), spendCheck(2, 3)],
      injected: { client: sc.client, sleep: noSleep },
    });
    expect(sc.calls()).toBe(1);
    expect(report.spend.calls).toBe(1);
    expect(report.outcome).toBe('aborted');
    expect(report.exitCode).toBe(3);
    expect(report.aborted?.kind).toBe('credits_depleted');
    expect(report.aborted?.fix).toContain('https://ai.studio/projects');
    expect(report.checks.filter((c) => c.status === 'SKIP')).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain(FAKE_SECRET);
  });
});

describe('401 invalid key', () => {
  it('aborts at the probe naming GEMINI_API_KEY', async () => {
    const sc = scriptedClient([{ status: 401 }]);
    const { report } = await runVerify({ env: baseEnv(), checks: [spendCheck(1, 2)], injected: { client: sc.client, sleep: noSleep } });
    expect(sc.calls()).toBe(1);
    expect(report.aborted?.kind).toBe('auth');
    expect(report.aborted?.fix).toContain('GEMINI_API_KEY');
    expect(report.exitCode).toBe(3);
  });
});

describe('429 rate limit', () => {
  it('retries a transient 429 and carries on (every attempt is counted)', async () => {
    const sc = scriptedClient([{ status: 429 }, { status: 200 }]);
    const waits: number[] = [];
    const { report } = await runVerify({
      env: baseEnv(),
      checks: [spendCheck(1, 1)],
      injected: { client: sc.client, sleep: async (ms) => void waits.push(ms) },
    });
    expect(report.outcome).toBe('pass');
    expect(report.spend.calls).toBe(3); // 429 + 200 on the probe, then the check's call
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeLessThanOrEqual(10_000);
  });

  it('a persistent 429 aborts with the rate-limit fix, not an endless retry', async () => {
    const sc = scriptedClient([{ status: 429 }]);
    const { report } = await runVerify({ env: baseEnv(), checks: [spendCheck(1, 5)], injected: { client: sc.client, sleep: noSleep } });
    expect(report.aborted?.kind).toBe('rate_limited');
    expect(sc.calls()).toBe(3); // 1 + 2 retries inside the adapter
    expect(report.exitCode).toBe(3);
    expect(report.aborted?.fix).toMatch(/LIVE_ONLY|LIVE_MAX_CALLS/);
  });
});

describe('200 and slow responses', () => {
  it('passes, accounts tokens, and reports latency percentiles', async () => {
    let t = 0;
    const sc = scriptedClient([{ status: 200, delayMs: 100, usage: { in: 50, out: 5 } }, { status: 200, delayMs: 900, usage: { in: 50, out: 5 } }], (ms) => (t += ms));
    const { report } = await runVerify({
      env: baseEnv(),
      checks: [spendCheck(1, 3)],
      injected: { client: sc.client, sleep: noSleep, now: () => t },
    });
    expect(report.outcome).toBe('pass');
    expect(report.exitCode).toBe(0);
    expect(report.spend.inputTokens).toBe(200);
    expect(report.spend.outputTokens).toBe(20);
    expect(report.latency.n).toBe(4);
    expect(report.latency.p95).toBe(900);
    expect(report.latency.p50).toBe(900);
  });

  it('records a FAIL (exit 1) when an answer is wrong, without aborting', async () => {
    const sc = scriptedClient([{ status: 200, text: 'OK' }, { status: 200, text: 'nope' }]);
    const { report } = await runVerify({ env: baseEnv(), checks: [spendCheck(1, 2)], injected: { client: sc.client } });
    expect(report.outcome).toBe('fail');
    expect(report.exitCode).toBe(1);
    expect(report.checks[1]?.steps.some((s) => s.status === 'FAIL')).toBe(true);
  });
});

describe('budget caps', () => {
  it('stops before the call that would exceed LIVE_MAX_CALLS', async () => {
    const sc = scriptedClient([{ status: 200 }]);
    const { report } = await runVerify({
      env: baseEnv({ LIVE_MAX_CALLS: '3' }),
      checks: [spendCheck(1, 10)],
      injected: { client: sc.client },
    });
    expect(sc.calls()).toBe(3);
    expect(report.outcome).toBe('budget');
    expect(report.exitCode).toBe(4);
    expect(report.aborted?.fix).toContain('LIVE_MAX_CALLS');
  });

  it('stops on the token cap using the estimate before the call', async () => {
    const sc = scriptedClient([{ status: 200, usage: { in: 3000, out: 500 } }]);
    const { report } = await runVerify({
      env: baseEnv({ LIVE_MAX_TOKENS: '5000' }),
      checks: [spendCheck(1, 10)],
      injected: { client: sc.client },
    });
    expect(report.outcome).toBe('budget');
    expect(report.spend.calls).toBeLessThanOrEqual(2); // overshoot is bounded by one call's actual overage
    expect(report.spend.billedTokens).toBeLessThanOrEqual(7000);
    expect(report.aborted?.fix).toContain('LIVE_MAX_TOKENS');
  });

  it('clamps output tokens to the per-call cap and the remaining budget', async () => {
    const sc = scriptedClient([{ status: 200 }]);
    await runVerify({ env: baseEnv({ LIVE_MAX_OUT_PER_CALL: '100' }), checks: [spendCheck(1, 1)], injected: { client: sc.client } });
    for (const p of sc.seen as { config: { maxOutputTokens: number } }[]) expect(p.config.maxOutputTokens).toBeLessThanOrEqual(100);
  });

  it('Budget characters and USD caps', () => {
    const b = new Budget({ ...limitsFromEnv({}), maxChars: 100, maxUsd: 1 });
    b.guardChars(60);
    expect(() => b.guardChars(60)).toThrow(/characters/);
    expect(b.fatal?.kind).toBe('budget');
    const c = new Budget({ ...limitsFromEnv({}), maxUsd: 0.0001 });
    expect(() => c.guardChars(500)).toThrow(/usd/);
  });

  it('defaults are the documented ones', () => {
    const l = limitsFromEnv({});
    expect([l.maxCalls, l.maxTokens, l.maxChars, l.maxUsd]).toEqual([150, 120000, 800, 0.5]);
  });
});

describe('secrets', () => {
  it('redacts keys from errors, evidence and the markdown report', async () => {
    const leaky = spendCheck(1, 1);
    leaky.run = async (_ctx, t) => {
      t.fail('leak attempt', `url ?key=${FAKE_SECRET} and raw ${FAKE_SECRET}`);
    };
    const { report, ctx } = await runVerify({ env: baseEnv(), checks: [leaky], injected: { client: scriptedClient([{ status: 200 }]).client } });
    const md = renderMarkdown(report, ctx.redact);
    expect(md).not.toContain(FAKE_SECRET);
    expect(JSON.stringify(report)).not.toContain(FAKE_SECRET);
    expect(makeRedactor({ GEMINI_API_KEY: FAKE_SECRET })(`x ${FAKE_SECRET}`)).toBe('x [redacted]');
  });

  it('parses .env without interpolation and ignores comments', () => {
    expect(parseDotEnv('# c\nA=1\nexport B="two"\nC=\n')).toEqual({ A: '1', B: 'two', C: '' });
  });
});

describe('selection and gating', () => {
  it('skips checks that need a missing key and does not probe when nothing needs Gemini', async () => {
    const sc = scriptedClient([{ status: 402 }]);
    const needsEleven = { ...spendCheck(7, 1), needs: ['elevenlabs' as const] };
    const { report } = await runVerify({
      env: { SQUAD_LIVE: '1' },
      checks: [needsEleven, spendCheck(1, 1)],
      injected: { client: sc.client },
    });
    expect(report.checks.every((c) => c.status === 'SKIP')).toBe(false); // client injected => gemini counts as present
    const none = await runVerify({ env: { SQUAD_LIVE: '1' }, checks: [needsEleven] });
    expect(none.report.checks[0]?.note).toContain('ELEVENLABS_API_KEY');
    expect(none.report.spend.calls).toBe(0);
  });

  it('LIVE_ONLY selects a subset', async () => {
    const sc = scriptedClient([{ status: 200 }]);
    const { report } = await runVerify({ env: baseEnv({ LIVE_ONLY: '2' }), checks: [spendCheck(1, 1), spendCheck(2, 1)], injected: { client: sc.client } });
    expect(report.checks.find((c) => c.id === 1)?.status).toBe('SKIP');
    expect(report.checks.find((c) => c.id === 2)?.status).toBe('PASS');
  });

  it('percentiles are nearest-rank', () => {
    expect(percentiles([1, 2, 3, 4, 100])).toEqual({ p50: 3, p95: 100, n: 5 });
    expect(percentiles([])).toEqual({ p50: 0, p95: 0, n: 0 });
  });
});
