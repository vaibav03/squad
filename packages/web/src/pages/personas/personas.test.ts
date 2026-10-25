import { describe, expect, it } from 'vitest';
import { HubPersonas, HubVoices } from './api';
import { PERSONAS, VOICES } from './fixtures';
import { initPersonas, isDirty, personasReducer } from './model';
import { buildSynthPlan } from './preview-audio';

describe('personas model', () => {
  it('tracks dirty state and reset', () => {
    let s = initPersonas(PERSONAS);
    expect(isDirty(s)).toBe(false);
    s = personasReducer(s, { type: 'edit', patch: { voiceId: 'sprinter' } });
    expect(isDirty(s)).toBe(true);
    s = personasReducer(s, { type: 'reset' });
    expect(isDirty(s)).toBe(false);
    s = personasReducer(s, { type: 'edit', patch: { sample: 'Hi' } });
    s = personasReducer(s, { type: 'saved', id: s.selected });
    expect(isDirty(s)).toBe(false);
  });
  it('ignores selecting unknown personas', () => {
    const s = initPersonas(PERSONAS);
    expect(personasReducer(s, { type: 'select', id: 'nope' })).toBe(s);
  });
});
describe('synth plan', () => {
  it('is deterministic per voice and text, and differs between voices', () => {
    const a = buildSynthPlan(VOICES[0]!, 'Hello there');
    expect(buildSynthPlan(VOICES[0]!, 'Hello there')).toEqual(a);
    expect(buildSynthPlan(VOICES[1]!, 'Hello there')).not.toEqual(a);
    expect(a.duration).toBeGreaterThan(0.8);
    expect(a.duration).toBeLessThan(6);
  });
});
describe('hub payloads', () => {
  it('rejects bad persona lists', () => {
    expect(HubPersonas.safeParse([{ id: 1 }]).success).toBe(false);
    expect(HubPersonas.safeParse([{ id: 'a', name: 'A', role: 'x' }]).success).toBe(true);
  });
});

describe('hub voices shape', () => {
  it('accepts the documented { voices } wrapper with label and a bare array', () => {
    const v = { id: 'voice_calm', name: 'Calm professor', label: 'calm' };
    expect(HubVoices.parse({ voices: [v] })).toEqual([v]);
    expect(HubVoices.parse([v])).toEqual([v]);
  });
});
