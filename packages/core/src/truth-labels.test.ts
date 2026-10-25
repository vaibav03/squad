import { describe, expect, it } from 'vitest';
import { headerTruth, messageTruth, TRUTH_LABELS, type CouncilTruth } from './truth-labels';

const base = { conn: 'live', online: true } as const;
const live = { demo: false };
const demo = { demo: true, reason: 'no_key' };
const demoCredits = { demo: true, reason: 'credits' };
const label = (status: Parameters<typeof headerTruth>[0]['status'], councils: CouncilTruth[]) =>
  headerTruth({ ...base, status, councils }).label;

describe('header badge matrix (transport live x council)', () => {
  it('provider live', () => {
    expect(label(live, [])).toBe('Live provider');
    expect(label(live, ['live'])).toBe('Live provider');
    expect(label(live, ['fixture'])).toBe('Live chat · Example council');
    expect(label(live, ['live', 'fixture'])).toBe('Live chat · Example council');
    expect(label(live, ['degraded'])).toBe('Live chat · Degraded council');
  });
  it('provider not answering for real', () => {
    expect(label(demo, [])).toBe('Not set up');
    expect(label(demoCredits, [])).toBe('Degraded');
    expect(label(demo, ['fixture'])).toBe('Fixture council');
  });
  it('never plain "Live" next to fixture content', () => {
    for (const s of [live, demo, demoCredits]) expect(label(s, ['fixture'])).not.toBe('Live');
  });
  it('transport problems win', () => {
    expect(headerTruth({ ...base, conn: 'expired', status: live, councils: [] }).label).toBe(
      'Signed out',
    );
    expect(headerTruth({ ...base, online: false, status: live, councils: [] }).label).toBe(
      'Offline',
    );
    expect(headerTruth({ ...base, conn: 'offline', status: live, councils: [] }).label).toBe(
      'Reconnecting',
    );
    expect(headerTruth({ ...base, status: null, councils: [] }).label).toBe('Connecting');
  });
  it('per-message badges carry their own truth', () => {
    expect(messageTruth(true).label).toBe('Example answer');
    expect(messageTruth(false, 'degraded:x_y_z').label).toBe('Degraded');
    expect(messageTruth(false).state).toBe('live');
    expect(TRUTH_LABELS.live).toBe('Live: answered by Gemini');
  });
});
