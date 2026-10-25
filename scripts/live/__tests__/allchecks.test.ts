import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { ALL_CHECKS } from '../checks';
import { runVerify } from '../lib/core';

const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe('every check runs to completion on a hostile model without crashing or overspending', () => {
  it('FakeLlm (answers nothing useful): checks FAIL cleanly, run ends, caps respected', async () => {
    const { report } = await runVerify({
      env: { SQUAD_LIVE: '1' },
      checks: ALL_CHECKS,
      limits: { maxCalls: 150, maxTokens: 1e7 },
      injected: { llm: new FakeLlm() },
    });
    expect(report.checks.map((c) => c.id).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const c of report.checks) expect(['PASS', 'FAIL', 'SKIP']).toContain(c.status);
    expect(report.spend.calls).toBeLessThanOrEqual(150);
    // Checks 7 (no ElevenLabs key) must be SKIP, and 8 (no chat API on this branch) must not crash.
    expect(report.checks.find((c) => c.id === 7)?.status).toBe('SKIP');
    expect(JSON.stringify(report)).not.toMatch(/crashed/);
    expect(report.outcome).toBe('fail');
  }, 60_000);
});

describe.skipIf(!ffmpeg)('check 7 (ElevenLabs) with an injected port', () => {
  const tone = () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tone-')), 't.mp3');
    spawnSync('ffmpeg', [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=300:duration=2',
      '-b:a',
      '64k',
      f,
    ]);
    return new Uint8Array(fs.readFileSync(f));
  };
  const port = () => {
    const audio = tone();
    return {
      listVoices: async () => [{ id: 'v1', name: 'Rachel', category: 'premade' }],
      designVoice: async () => [{ generatedVoiceId: 'g1' }],
      tts: async (_v: string, text: string) => ({ audio, timings: text.length }),
      dialogue: async () => audio,
    };
  };
  const run = (env: Record<string, string>, eleven = port()) =>
    runVerify({
      env: { SQUAD_LIVE: '1', ELEVENLABS_API_KEY: 'x'.repeat(20), ...env },
      checks: ALL_CHECKS.filter((c) => c.id === 7),
      injected: { llm: new FakeLlm(), eleven, tools: { ffmpeg: true } },
    });

  it('SKIPs every billed step unless LIVE_ELEVENLABS=1', async () => {
    const { report } = await run({});
    const c = report.checks.find((x) => x.id === 7)!;
    expect(c.status).toBe('SKIP');
    expect(report.spend.chars).toBe(0);
  });
  it('passes all steps with LIVE_ELEVENLABS=1 and measures loudness', async () => {
    const { report } = await run({ LIVE_ELEVENLABS: '1' });
    const c = report.checks.find((x) => x.id === 7)!;
    expect(c.steps.filter((s) => s.status === 'FAIL').map((s) => s.evidence[0])).toEqual([]);
    expect(c.status).toBe('PASS');
    expect(Number(c.metrics['integrated loudness LUFS'])).toBeLessThan(0);
  });
  it('fails (not crashes) when timings are missing', async () => {
    const p = port();
    p.tts = async () => ({ audio: tone(), timings: 0 });
    const { report } = await run({ LIVE_ELEVENLABS: '1' }, p);
    expect(report.checks.find((x) => x.id === 7)?.status).toBe('FAIL');
  });
});
