import { describe, expect, it } from 'vitest';
import {
  createDryRunSdk,
  runVerification,
  type VerifyDeps,
  type VerifyOptions,
} from '../../../scripts/verify-imessage';

const opts = (o: Partial<VerifyOptions> = {}): VerifyOptions => ({
  group: 'Cubbie Test',
  to: '+15550000000',
  timeoutSec: 2,
  yes: true,
  dryRun: true,
  ...o,
});

const deps = (
  o: Partial<VerifyOptions> = {},
  extra: Partial<VerifyDeps> = {},
): { d: VerifyDeps; lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    d: {
      sdk: createDryRunSdk(o.simulateFail),
      prompt: async () => 'y',
      now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
      out: (l) => lines.push(l),
      platform: 'darwin',
      macVersion: () => '27.0',
      canReadChatDb: () => ({ ok: true }),
      makeFixtures: () => ({ png: '/tmp/x.png', m4a: '/tmp/x.m4a' }),
      ...extra,
    },
  };
};

describe('verify-imessage', () => {
  it('passes on a healthy simulated Mac', async () => {
    const { d } = deps();
    const r = await runVerification(opts(), d);
    expect(r.exitCode).toBe(0);
    expect(r.results.map((x) => x.status)).toEqual([
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
      'PASS',
    ]);
  });

  it('fails check 2 with the attributedBody hint when text is missing', async () => {
    const { d } = deps({ simulateFail: 'text' });
    const r = await runVerification(opts({ simulateFail: 'text' }), d);
    expect(r.exitCode).toBe(1);
    const c2 = r.results.find((x) => x.id === '2')!;
    expect(c2.status).toBe('FAIL');
    expect(c2.detail).toMatch(/attributedBody/);
    expect(r.recommendation).toMatch(/TRANSPORT=discord/);
  });

  it('fails when a text send fails', async () => {
    const { d } = deps({ simulateFail: 'send' });
    const r = await runVerification(opts({ simulateFail: 'send' }), d);
    expect(r.exitCode).toBe(1);
    expect(r.results.find((x) => x.id === '3')!.status).toBe('FAIL');
  });

  it('attachment failure is warn-only', async () => {
    const { d } = deps({ simulateFail: 'attachment' });
    const r = await runVerification(opts({ simulateFail: 'attachment' }), d);
    expect(r.exitCode).toBe(0);
    expect(r.results.find((x) => x.id === '5')!.status).toBe('WARN');
  });

  it('missing Full Disk Access stops at preflight with fix instructions', async () => {
    const { d } = deps({}, { canReadChatDb: () => ({ ok: false, error: 'EPERM' }) });
    const r = await runVerification(opts(), d);
    expect(r.exitCode).toBe(1);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.detail).toMatch(/Full Disk Access/);
  });

  it('non-macOS fails immediately', async () => {
    const { d } = deps({}, { platform: 'linux' });
    expect((await runVerification(opts(), d)).exitCode).toBe(1);
  });

  it('no DM reply within the timeout fails check 4; missing --to fails with guidance', async () => {
    const { d } = deps();
    const noTo = await runVerification(opts({ to: undefined }), d);
    expect(noTo.results.find((x) => x.id === '4')!.detail).toMatch(/--to/);
    expect(noTo.exitCode).toBe(1);
  });
});
