import { describe, expect, it } from 'vitest';
import type { Connection } from './api';
import { calendarUsable, deriveProviderState, sourceChipLabel, STATE_WORDS } from './connection-state';

const NOW = 1_700_000_000_000;
const c = (o: Partial<Connection> = {}): Connection => ({
  id: 'c1', provider: 'google', variant: 'oauth', mode: 'live', state: 'live', stateLabel: '', retryAfter: null,
  syncPhase: 'idle', cursor: null, lastOutcome: 'ok', note: null, scopes: [], lastSyncAt: NOW - 42_000, canSync: true,
  syncVia: 'hub', sources: { total: 4, byKind: {} }, sharedWithSquads: [], needsReconnect: false, account: null,
  grantedScopes: [], ...o,
});
const d = (list: Connection[], o = {}) => deriveProviderState('google', list, { now: NOW, ...o });

describe('provider state machine', () => {
  it('not connected: connect CTA and the full connect panel', () => {
    const v = d([]);
    expect([v.state, v.label, v.cta, v.ctaLabel, v.showConnectPanel, v.showRepair]).toEqual(['not_connected', 'Not connected', 'connect', 'Connect Google', true, false]);
    expect(v.text).toBe('No Google account is connected.');
  });
  it('connecting: after the OAuth return, before any record exists; no panel, no CTA', () => {
    const v = d([], { justReturned: true });
    expect([v.state, v.label, v.cta, v.showConnectPanel]).toEqual(['connecting', 'Connecting', 'none', false]);
  });
  it('syncing for the first time says the first sync is running (only here)', () => {
    const v = d([c({ syncPhase: 'syncing', lastSyncAt: null, sources: { total: 0, byKind: {} } })]);
    expect([v.state, v.firstSyncRunning, v.lastSyncText, v.cta]).toEqual(['syncing', true, null, 'none']);
    expect(v.text).toContain('first sync is running');
  });
  it('syncing again after a successful sync never says "first sync"', () => {
    const v = d([c({ syncPhase: 'syncing' })]);
    expect(v.state).toBe('syncing');
    expect(v.firstSyncRunning).toBe(false);
    expect(v.text).not.toMatch(/first sync/i);
    expect(v.text).toContain('42 s ago');
  });
  it('live: no connect panel, last sync text, Review then Ask', () => {
    const v = d([c()]);
    expect([v.state, v.label, v.showConnectPanel, v.cta, v.ctaLabel]).toEqual(['live', 'Live', false, 'review', 'Review imported context']);
    expect(v.lastSyncText).toBe('Last synced 42 s ago (ok)');
    expect(v.text).not.toMatch(/first sync/i);
    expect(d([c()], { reviewed: true }).ctaLabel).toBe('Ask Nook with this');
    expect(d([c({ sources: { total: 0, byKind: {} } })]).cta).toBe('none');
  });
  it('demo is its own state: label Demo data, never Live', () => {
    const v = d([c({ mode: 'fixture', state: 'fixture' })]);
    expect([v.state, v.label, v.fixture, v.usable]).toEqual(['demo', 'Demo data', true, true]);
    expect(v.label).not.toBe('Live');
    expect(sourceChipLabel('canvas', true)).toBe('Demo: Canvas');
    expect(sourceChipLabel('google', true)).toBe('Demo: Google');
    expect(sourceChipLabel('google', false)).toBe('Google');
  });
  it('degraded: Reconnect + repair, data kept', () => {
    for (const o of [{ state: 'error' as const }, { state: 'rate_limited' as const }, { degraded: true }]) {
      const v = d([c(o)]);
      expect([v.state, v.cta, v.ctaLabel, v.showRepair, v.showConnectPanel]).toEqual(['degraded', 'reconnect', 'Reconnect', true, false]);
    }
  });
  it('reauth required: Reconnect, text keeps the last sync', () => {
    const v = d([c({ state: 'expired', needsReconnect: true })]);
    expect([v.state, v.label, v.cta, v.showRepair, v.showConnectPanel]).toEqual(['reauth', 'Reconnect needed', 'reconnect', true, false]);
    expect(v.text).toContain('last synced 42 s ago');
  });
  it('disconnected is a sub-state of not connected: panel returns, data gone', () => {
    const v = d([c({ state: 'revoked', sources: { total: 0, byKind: {} } })]);
    expect([v.state, v.sub, v.label, v.showConnectPanel, v.cta, v.hasItems]).toEqual(['not_connected', 'disconnected', 'Disconnected', true, 'connect', false]);
  });
  it('an active record wins over an old revoked one', () => {
    expect(d([c({ id: 'old', state: 'revoked' }), c({ id: 'new' })]).state).toBe('live');
  });
  it('label map has every state exactly once', () => {
    expect(Object.values(STATE_WORDS)).toEqual(['Not connected', 'Connecting', 'Syncing', 'Live', 'Demo data', 'Degraded', 'Reconnect needed']);
  });
  it('Home checklist: real usable calendar only; demo and reauth do not count', () => {
    expect(calendarUsable([c()])).toBe(true);
    expect(calendarUsable([c({ mode: 'fixture', state: 'fixture' })])).toBe(false);
    expect(calendarUsable([c({ state: 'expired' })])).toBe(false);
    expect(calendarUsable([c({ provider: 'canvas', variant: 'feed' })])).toBe(true);
    expect(calendarUsable([c({ provider: 'canvas', variant: 'session' })])).toBe(false);
  });
});

describe('hub integrationState is the source of truth', () => {
  it('overrides the derivation; fallback only when absent', () => {
    // fields say live, hub says reauth_required: the hub wins
    const v = d([c({ integrationState: 'reauth_required' })]);
    expect([v.state, v.label, v.cta, v.showRepair]).toEqual(['reauth', 'Reconnect needed', 'reconnect', true]);
    // a demo record the hub says is demo even if mode were mis-sent
    expect(d([c({ integrationState: 'demo', mode: 'fixture' })]).state).toBe('demo');
    expect(d([c({ integrationState: 'syncing', lastSyncAt: null })]).firstSyncRunning).toBe(true);
    expect(d([c({ integrationState: 'not_connected', integrationSub: 'disconnected', state: 'revoked' })]).label).toBe('Disconnected');
    expect(d([c({ integrationState: 'not_connected', integrationSub: null, state: 'revoked' })]).sub).toBeNull();
    expect(d([c({ integrationState: 'degraded' })]).state).toBe('degraded');
  });
  it('labels come from core INTEGRATION_STATE_LABELS', () => {
    expect(STATE_WORDS.demo).toBe('Demo data');
    expect(STATE_WORDS.live).toBe('Live');
  });
});
