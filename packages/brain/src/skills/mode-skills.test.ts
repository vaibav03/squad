import { LlmError, type AgentMode } from '@squad/core';
import { describe, expect, it } from 'vitest';
import { fallbackMode, modeLabel, startMode, worse } from './mode-util';
import { rubricUnavailableReply } from './rubric/skill';

describe('mode-util', () => {
  it('defaults to live and honours a getter', () => {
    expect(startMode({})).toBe('live');
    expect(startMode({ mode: () => 'demo:no_key' })).toBe('demo:no_key');
  });
  it('a live run that lost its model is degraded, a demo run stays demo, never live', () => {
    expect(fallbackMode('live', new LlmError('credits_depleted', 'HTTP 402'))).toBe(
      'degraded:credits_depleted',
    );
    expect(fallbackMode('live')).toBe('degraded:model_error');
    expect(fallbackMode('demo:no_key', new Error('x'))).toBe('demo:no_key');
  });
  it('labels', () => {
    expect(modeLabel('live')).toBe('');
    expect(modeLabel('demo')).toMatch(/Demo, scripted/);
    expect(modeLabel('degraded:rate_limited')).toMatch(/Degraded: rate limited/);
    const m: AgentMode = worse('live', 'degraded:timeout');
    expect(m).toBe('degraded:timeout');
    expect(worse('degraded:timeout', 'demo')).toBe('demo');
  });
  it('rubric unavailable reply carries the label', () => {
    expect(rubricUnavailableReply(['a'], 'demo')).toMatch(/^\(Demo, scripted/);
    expect(rubricUnavailableReply(['a'], 'degraded:timeout')).toMatch(/^\(Degraded: timeout/);
  });
});
