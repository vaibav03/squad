import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Llm, LlmJsonRequest, LlmPart, LlmRequest } from '@squad/core';
import { visionCheck } from '../checks/03-vision';
import { runVerify } from '../lib/core';
import { FIXTURES } from '../lib/fx';

const b64 = (f: string) => fs.readFileSync(path.join(FIXTURES, f)).toString('base64');
const A = ['2x + 6 = 14', '2x = 14 - 6', '2x = 8', 'x = 4'];
const B = ['2x + 6 = 14', '2x = 14 + 6', '2x = 20', 'x = 10'];

function visionLlm(opts: { blind?: boolean } = {}): Llm {
  const imageOf = (req: { messages: LlmRequest['messages'] }) => {
    const m = typeof req.messages === 'string' ? [] : req.messages;
    for (const msg of m)
      if (Array.isArray(msg.content))
        for (const p of msg.content as LlmPart[]) if (p.type === 'image' && 'data' in p) return p;
    return undefined;
  };
  return {
    async complete(req: LlmRequest) {
      const img = imageOf(req);
      const text =
        img?.mimeType === 'application/pdf'
          ? 'Coin flips. A fair coin lands heads with probability one half. Two independent flips both land heads with probability one quarter.'
          : 'OK';
      return { text, toolCalls: [] };
    },
    async json<T>(req: LlmJsonRequest<T>): Promise<T> {
      const img = imageOf(req);
      if (img) {
        const steps = opts.blind || img.data === b64('stepdiff-a.png') ? A : B;
        return { legible: true, steps: steps.map((text) => ({ text })) } as T;
      }
      const m = String(typeof req.messages === 'string' ? req.messages : '');
      const mm = /Step A: (.*)\nStep B: (.*)\n/.exec(m);
      return { equivalent: mm?.[1] === mm?.[2], concept: 'inverse operations' } as T;
    },
    async createCache() {
      throw new Error('no cache');
    },
  };
}

const run = (llm: Llm) =>
  runVerify({
    env: { SQUAD_LIVE: '1' },
    checks: [visionCheck],
    injected: { llm },
    limits: { maxCalls: 100 },
  }).then((r) => r.report.checks.find((c) => c.id === 3)!);

describe('check 3 (vision) with a scripted vision model', () => {
  it('passes when the model transcribes faithfully: split at step 2, no verdict, scanned page recovered', async () => {
    const c = await run(visionLlm());
    expect(c.steps.filter((s) => s.status === 'FAIL').map((s) => s.evidence[0])).toEqual([]);
    expect(c.status).toBe('PASS');
  });
  it('FAILS when the transcription loses the divergence', async () => {
    const c = await run(visionLlm({ blind: true }));
    expect(c.status).toBe('FAIL');
    expect(c.steps.find((s) => s.name.startsWith('two photos'))?.evidence[0]).toContain(
      'expected 2',
    );
  });
  it('the committed fixtures are real images with no text layer', () => {
    expect(fs.statSync(path.join(FIXTURES, 'stepdiff-a.png')).size).toBeGreaterThan(5000);
    expect(fs.readFileSync(path.join(FIXTURES, 'scanned-page.pdf')).includes('/Type /Font')).toBe(
      false,
    );
  });
});
