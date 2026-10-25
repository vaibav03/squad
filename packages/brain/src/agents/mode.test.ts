import { LlmError } from '@squad/core';
import { describe, expect, it } from 'vitest';
import {
  councilAgentsFlag,
  decideRunMode,
  degraded,
  degradedReason,
  isHaltReason,
  modeInputsFromEnv,
} from './mode';

describe('decideRunMode (the one decision point)', () => {
  const real = { llm: 'real' as const };
  it.each([
    [{ hasKey: false, forced: false }, 'demo:no_key'],
    [{ hasKey: false, forced: true }, 'demo:no_key'],
    [{ hasKey: true, forced: true }, 'demo:forced'],
    [{ hasKey: true, forced: false }, 'live'],
    [{ hasKey: true, forced: false, health: real }, 'live'],
    [
      { hasKey: true, forced: false, health: { llm: 'fake', reason: 'credits_depleted' } },
      'demo:credits_depleted',
    ],
    [
      { hasKey: true, forced: false, health: { llm: 'fake', reason: 'rate_limited' } },
      'demo:rate_limited',
    ],
    [
      { hasKey: true, forced: false, health: { llm: 'fake', reason: 'invalid_key' } },
      'demo:invalid_key',
    ],
    [{ hasKey: true, forced: false, health: { llm: 'fake', reason: 'probing' } }, 'demo:probing'],
    [{ hasKey: true, forced: false, health: { llm: 'fake', reason: 'no_key' } }, 'demo:no_key'],
    [
      { hasKey: true, forced: false, health: { llm: 'fake', reason: 'forced_fake' } },
      'demo:forced',
    ],
    [{ hasKey: true, forced: false, health: { llm: 'fake' } }, 'demo:unavailable'],
    [{ hasKey: true, forced: false, health: { llm: 'fake', reason: '??' } }, 'demo:unavailable'],
  ] as const)('%j -> %s', (inp, want) => {
    expect(decideRunMode(inp as never)).toBe(want);
  });

  it('reads the env', () => {
    expect(modeInputsFromEnv({})).toEqual({ hasKey: false, forced: false });
    expect(modeInputsFromEnv({ GEMINI_API_KEY: 'k', FORCE_FAKE_LLM: '1' }).forced).toBe(true);
    expect(modeInputsFromEnv({ GEMINI_API_KEY: 'k', CHAT_FORCE_DEMO: '1' }).forced).toBe(true);
    expect(modeInputsFromEnv({ GEMINI_API_KEY: 'k', FORCE_FAKE_LIVE: '1' }).forced).toBe(true);
    expect(decideRunMode(modeInputsFromEnv({ GEMINI_API_KEY: 'k' }))).toBe('live');
  });
});

describe('degradedReason', () => {
  it.each([
    [new LlmError('credits_depleted', 'x', 402), 'credits_depleted'],
    [new LlmError('rate_limited', 'x', 429), 'rate_limited'],
    [new LlmError('auth', 'x', 401), 'invalid_key'],
    [new LlmError('other', 'x', 500), 'model_error'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'timeout'],
    [new Error('request timed out'), 'timeout'],
    [new Error('reason:session_closed'), 'session_closed'],
    [new Error('Live closed 1011'), 'session_closed'],
    [new Error('prepayment credits depleted'), 'credits_depleted'],
    [new Error('429 quota exhausted'), 'rate_limited'],
    [new Error('API key invalid'), 'invalid_key'],
    [new Error('???'), 'model_error'],
    ['nope', 'model_error'],
  ])('%s', (e, want) => {
    expect(degradedReason(e)).toBe(want);
  });
  it('helpers', () => {
    expect(degraded('timeout')).toBe('degraded:timeout');
    expect(['credits_depleted', 'invalid_key', 'budget'].every(isHaltReason)).toBe(true);
    expect(['rate_limited', 'timeout', 'no_turn'].some(isHaltReason)).toBe(false);
  });
});

describe('councilAgentsFlag', () => {
  it('defaults to v2, v1 only on an explicit rollback value', () => {
    expect(councilAgentsFlag({})).toBe('v2');
    expect(councilAgentsFlag({ COUNCIL_AGENTS: 'v2' })).toBe('v2');
    expect(councilAgentsFlag({ COUNCIL_AGENTS: ' V1 ' })).toBe('v1');
    expect(councilAgentsFlag({ COUNCIL_AGENTS: 'off' })).toBe('v1');
    expect(councilAgentsFlag({ COUNCIL_AGENTS: '0' })).toBe('v1');
    expect(councilAgentsFlag({ COUNCIL_AGENTS: 'garbage' })).toBe('v2');
  });
});
