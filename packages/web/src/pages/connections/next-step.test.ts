import { describe, expect, it } from 'vitest';
import { nextStep } from './next-step';
import type { Connection } from './api';

const c = (o: Partial<Connection> = {}): Connection =>
  ({
    id: 'c1',
    provider: 'canvas',
    variant: 'session',
    mode: 'live',
    state: 'live',
    stateLabel: '',
    retryAfter: null,
    syncPhase: 'idle',
    cursor: null,
    lastOutcome: null,
    note: null,
    scopes: [],
    lastSyncAt: 1,
    canSync: true,
    syncVia: 'hub',
    sources: { total: 3, byKind: { canvas_assignment: 3 } },
    sharedWithSquads: [],
    needsReconnect: false,
    account: null,
    grantedScopes: [],
    ...o,
  }) as Connection;

describe('nextStep: one primary action per state', () => {
  it('loading has none, offline retries, demo signs in', () => {
    expect(nextStep('loading', []).cta).toBeNull();
    expect(nextStep('offline', []).cta).toMatchObject({ label: 'Try again', kind: 'retry' });
    expect(nextStep('demo', []).cta).toMatchObject({ label: 'Sign in', to: '/welcome' });
  });
  it('nothing connected asks to connect Canvas or Google', () => {
    const n = nextStep('ready', []);
    expect(n.next).toBe('connect Canvas or Google');
    expect(n.cta).toMatchObject({ kind: 'hash', to: '#canvas' });
  });
  it('an expired connection is fixed first, at its own card', () => {
    const n = nextStep('ready', [c({ provider: 'google', state: 'expired' })]);
    expect(n.cta).toMatchObject({ label: 'Sign in to Google again', to: '#google' });
  });
  it('imported but not reviewed asks for a review, then sends you to the chat', () => {
    expect(nextStep('ready', [c()], false).cta).toMatchObject({ to: '#imported' });
    const done = nextStep(
      'ready',
      [
        c(),
        c({ id: 'g', provider: 'google', sources: { total: 1, byKind: { classroom_item: 1 } } }),
      ],
      true,
    );
    expect(done.next).toContain('Everything is connected');
    expect(done.cta).toMatchObject({ kind: 'route', to: '/squad/chat' });
  });
});
