import type { Connection } from './api';
import { plural } from '../../lib/plural';
import { relTime } from './model';

/**
 * THE per-provider state machine. Every surface (OAuth-return banner, card, health summary, Home checklist, CTA,
 * which panels show) renders from `deriveProviderState`; none re-derives state from raw fields.
 */
export const PROVIDER_STATES = [
  'not_connected',
  'connecting',
  'syncing',
  'live',
  'demo',
  'degraded',
  'reauth',
] as const;
export type ProviderState = (typeof PROVIDER_STATES)[number];
export type Provider = 'canvas' | 'google';
export type Cta = 'connect' | 'reconnect' | 'review' | 'ask' | 'none';

/** THE label map (onboarding, Home, Connections, health, chat chips). `demo` reads 'Demo data', never 'Live'. */
export const STATE_WORDS: Record<ProviderState, string> = {
  not_connected: 'Not connected',
  connecting: 'Connecting',
  syncing: 'Syncing',
  live: 'Live',
  demo: 'Demo data',
  degraded: 'Degraded',
  reauth: 'Reauth required',
};
/** Disconnected is a sub-state of Not connected (its data was deleted). */
export const SUB_WORDS = { disconnected: 'Disconnected' } as const;
export type ProviderSub = keyof typeof SUB_WORDS | null;

export { sourceChipLabel } from '@squad/core';
const NAME: Record<Provider, string> = { canvas: 'Canvas', google: 'Google' };

export interface DeriveOpts {
  now: number;
  /** The page was just opened from the provider's OAuth return (`?status=connected`) and no record is listed yet. */
  justReturned?: boolean;
  /** The imported items were opened and looked at (drives Review -> Ask). */
  reviewed?: boolean;
}

export interface ProviderView {
  provider: Provider;
  state: ProviderState;
  sub: ProviderSub;
  /** Exact word for the state chip (the sub-state word when there is one). */
  label: string;
  connection: Connection | null;
  fixture: boolean;
  /** One sentence for the card / OAuth-return banner. Says "first sync is running" ONLY while syncing with no successful sync yet. */
  text: string;
  /** Single contextual call to action. */
  cta: Cta;
  ctaLabel: string | null;
  /** Show the full connect panel (Google sign-in / Canvas steps). */
  showConnectPanel: boolean;
  /** Reconnect + Disconnect only (no connect flow). */
  showRepair: boolean;
  /** The card has data to show (kept on expired/degraded; purged on disconnect). */
  hasItems: boolean;
  firstSyncRunning: boolean;
  /** `Last synced 42 s ago (ok)` or null when no sync succeeded yet. */
  lastSyncText: string | null;
  /** Healthy enough to count as done on the Home checklist. */
  usable: boolean;
}

/** The primary record: an active one wins over disconnected ones; the newest sync wins among actives. */
export function primaryConnection(conns: readonly Connection[]): Connection | null {
  const active = conns.filter((c) => c.state !== 'revoked');
  const pool = active.length ? active : conns;
  return [...pool].sort((a, b) => (b.lastSyncAt ?? 0) - (a.lastSyncAt ?? 0))[0] ?? null;
}

export function deriveProviderState(
  provider: Provider,
  conns: readonly Connection[],
  o: DeriveOpts,
): ProviderView {
  const c = primaryConnection(conns);
  const name = NAME[provider];
  const base = { provider, connection: c, fixture: c?.mode === 'fixture' && c.state !== 'revoked' };
  const items = c && c.state !== 'revoked' ? c.sources.total : 0;
  const mk = (
    state: ProviderState,
    text: string,
    cta: Cta,
    ctaLabel: string | null,
    extra: Partial<ProviderView> = {},
  ): ProviderView => ({
    ...base,
    state,
    sub: null,
    label: STATE_WORDS[state],
    text,
    cta,
    ctaLabel,
    showConnectPanel: state === 'not_connected',
    showRepair: state === 'degraded' || state === 'reauth',
    hasItems: items > 0,
    firstSyncRunning: false,
    lastSyncText: c && c.lastSyncAt ? `Last synced ${relTime(c.lastSyncAt, o.now)}${c.lastOutcome ? ` (${c.lastOutcome})` : ''}` : null,
    usable: state === 'live' || state === 'syncing' || state === 'demo',
    ...extra,
  });
  const connect = `Connect ${name}`;

  if (!c)
    return o.justReturned
      ? mk('connecting', `${name} is connecting. Waiting for the connection to be recorded.`, 'none', null)
      : mk('not_connected', `No ${name} account is connected.`, 'connect', connect);
  if (c.state === 'revoked')
    return o.justReturned
      ? mk('connecting', `${name} is connecting. Waiting for the connection to be recorded.`, 'none', null)
      : mk(
          'not_connected',
          c.note ?? `${name} was disconnected and the imported data was deleted.`,
          'connect',
          connect,
          { sub: 'disconnected', label: SUB_WORDS.disconnected },
        );
  const last = c.lastSyncAt;
  const ago = last ? relTime(last, o.now) : null;
  if (c.state === 'expired' || c.needsReconnect)
    return mk(
      'reauth',
      `${name} needs you to sign in again. Imported data is kept${ago ? ` (last synced ${ago})` : ''} but may be out of date.`,
      'reconnect',
      'Reconnect',
    );
  if (c.syncPhase === 'syncing') {
    const first = last === null;
    return mk(
      'syncing',
      first
        ? `${name} connected. The first sync is running.`
        : `${name} is syncing again. Last successful sync ${ago}.`,
      items > 0 ? (o.reviewed ? 'ask' : 'review') : 'none',
      items > 0 ? (o.reviewed ? 'Ask Cubbie with this' : 'Review imported context') : null,
      { firstSyncRunning: first },
    );
  }
  if (c.state === 'error' || c.state === 'rate_limited' || c.degraded)
    return mk(
      'degraded',
      c.state === 'rate_limited'
        ? `${name} asked Squad to slow down. Retrying automatically; showing the last imported data${ago ? ` (${ago})` : ''}.`
        : `The last ${name} sync failed. Showing the last imported data${ago ? ` (synced ${ago})` : ''}.`,
      'reconnect',
      'Reconnect',
    );
  const text = ago
    ? `${name} connected. ${plural(items, 'item')} imported.`
    : `${name} connected. No sync has completed yet.`;
  return mk(
    base.fixture ? 'demo' : 'live',
    text,
    items > 0 ? (o.reviewed ? 'ask' : 'review') : 'none',
    items > 0 ? (o.reviewed ? 'Ask Cubbie with this' : 'Review imported context') : null,
  );
}

/** Home checklist: a real (not fixture) calendar source that is usable. */
export function calendarUsable(conns: readonly Connection[]): boolean {
  return (['google', 'canvas'] as const).some((p) => {
    const list = conns.filter((c) => c.provider === p && (p === 'google' || c.variant === 'feed'));
    const v = deriveProviderState(p, list, { now: 0 });
    return v.usable && v.state !== 'demo' && v.connection?.mode === 'live';
  });
}
