import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUnwrappedScripted, scripted } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { createDemoTransport, demoText } from './demo-transport';

const here = dirname(fileURLToPath(import.meta.url));
const STOCK = ['stock', 'fallbackQuestion', 'pickDemo', 'defaultWhy', 'rubricUnavailableReply'];

describe('script-wrap lint', () => {
  const files = [
    ...readdirSync(here)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-kit.ts')
      .map((f) => join(here, f)),
    join(here, '..', 'councils', 'ask-v2.ts'),
  ].filter((f) => existsSync(f));

  it('scans the runtime files', () => {
    expect(files.length).toBeGreaterThan(5);
  });
  it.each(files.map((f) => [f.slice(here.length - 6), f]))(
    '%s has no unwrapped stock helpers',
    (_n, f) => {
      expect(findUnwrappedScripted(readFileSync(f as string, 'utf8'), STOCK)).toEqual([]);
    },
  );
  it('the lint itself catches an unwrapped call and accepts a wrapped one', () => {
    expect(findUnwrappedScripted('const a = stock("x");', STOCK)).toHaveLength(1);
    expect(findUnwrappedScripted('const a = scripted(stock("x"));', STOCK)).toEqual([]);
  });
});

describe('scripted text is branded', () => {
  it('scripted() refuses live and demoText is source script', () => {
    expect(() => scripted('x', 'live' as never)).toThrow();
    expect(scripted('x').source).toBe('script');
    expect(scripted('x', 'degraded:timeout').mode).toBe('degraded:timeout');
    expect(demoText('hello')).toBe('hello');
  });
  it('the default demo session submits through submit_turn only', async () => {
    const s = createDemoTransport().open({
      spec: {
        id: 'council:zz-a',
        key: 'a',
        role: 'specialist',
        displayName: 'A',
        stance: '',
        system: '',
        tools: [],
        tier: 'main',
      },
      system: '',
      tools: [],
      children: [],
      maxOutputTokens: 100,
    });
    const r = await s.send('q');
    expect(r.text).toBe('');
    expect(r.toolCalls.map((c) => c.name)).toEqual(['submit_turn']);
  });
});
