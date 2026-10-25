import { describe, expect, it } from 'vitest';
import { scanForThinking, suspectWindows, type RawCapture } from '../lib/thinking-scan';

const raw = (over: Partial<RawCapture> = {}): RawCapture => ({
  thoughts: [
    'First I will weigh the claim that the median resists extreme values because ranks ignore magnitude, then decide.',
  ],
  signatures: ['Sig0123456789abcdefghijklmnopqrstuvwxyz=='],
  authorized: ['What is better for skewed data, mean or median?'],
  ...over,
});

describe('thinking scan', () => {
  it('passes clean payloads and public capped `thought` summaries', () => {
    const f = scanForThinking(
      [
        {
          where: 'frame0',
          value: { t: 'a2a.message', msg: { summary: 'Median.', thought: 'Checking page 3.' } },
        },
        { where: 'result', value: { verdict: { text: 'Use the median.' } } },
      ],
      raw(),
    );
    expect(f).toEqual([]);
  });

  it('flags a thought-like key anywhere', () => {
    const f = scanForThinking(
      [{ where: 'f', value: { msg: { reasoning: 'x', nested: [{ thoughtSignature: 'y' }] } } }],
      raw(),
    );
    expect(
      f
        .filter((x) => x.kind === 'key')
        .map((x) => (x as { key: string }).key)
        .sort(),
    ).toEqual(['reasoning', 'thoughtSignature']);
  });

  it('flags an over-long public thought', () => {
    const f = scanForThinking([{ where: 'f', value: { thought: 'x'.repeat(241) } }], raw());
    expect(f[0]?.kind).toBe('thought_too_long');
  });

  it('flags raw thinking text that leaked into a payload', () => {
    const leaked =
      'Note: weigh the claim that the median resists extreme values because ranks ignore magnitude';
    const f = scanForThinking([{ where: 'f', value: { msg: { summary: leaked } } }], raw());
    expect(f.some((x) => x.kind === 'text')).toBe(true);
  });

  it('does not flag thinking that equals authorized public text (the model drafted its own answer)', () => {
    const r = raw({
      authorized: [
        'First I will weigh the claim that the median resists extreme values because ranks ignore magnitude, then decide.',
      ],
    });
    expect(suspectWindows(r)).toEqual([]);
    const f = scanForThinking(
      [
        {
          where: 'f',
          value: { summary: 'The median resists extreme values because ranks ignore magnitude.' },
        },
      ],
      r,
    );
    expect(f).toEqual([]);
  });

  it('flags a raw thought signature', () => {
    const f = scanForThinking(
      [{ where: 'f', value: { note: 'x Sig0123456789abcdefghijklmnopqrstuvwxyz== y' } }],
      raw(),
    );
    expect(f.some((x) => x.kind === 'signature')).toBe(true);
  });
});
