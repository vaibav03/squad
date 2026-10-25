import { INTEGRATION_STATE_LABELS, INTEGRATION_SUB_LABELS, type IntegrationState } from '@squad/core';
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
  not_connected: INTEGRATION_STATE_LABELS.not_connected,
  connecting: INTEGRATION_STATE_LABELS.connecting,
  syncing: INTEGRATION_STATE_LABELS.syncing,
  live: INTEGRATION_STATE_LABELS.live,
  demo: INTEGRATION_STATE_LABELS.demo,
  degraded: INTEGRATION_STATE_LABELS.degraded,
  reauth: INTEGRATION_STATE_LABELS.reauth_required,
};
/** Disconnected is a sub-state of Not connected (its data was deleted). */
export const SUB_WORDS = INTEGRATION_SUB_LABELS;
export type ProviderSub = keyof typeof SUB_WORDS | null;

/** Citation / source chip text: demo sources never read as real. */
export const sourceChipLabel = (provider: Provider, fixture: boolean): string =>
  fixture ? `Demo: ${NAME[provider]}` : NAME[provider];
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

/** Fallback only: the hub's `integrationState` is the source of truth; this mirrors its rules for older hubs. */
function fallbackState(c: Connection | null, justReturned: boolean): { state: ProviderState; sub: ProviderSub } {
  if (!c || c.state === 'revoked')
    return justReturned
      ? { state: 'connecting', sub: null }
      : { state: 'not_connected', sub: c ? 'disconnected' : null };
  if (c.state === 'expired' || c.needsReconnect) return { state: 'reauth', sub: null };
  if (c.syncPhase === 'syncing') return { state: 'syncing', sub: null };
  if (c.state === 'error' || c.state === 'rate_limited' || c.degraded) return { state: 'degraded', sub: null };
  return { state: c.mode === 'fixture' ? 'demo' : 'live', sub: null };
}

const FROM_HUB: Record<IntegrationState, ProviderState> = {
  not_connected: 'not_connected',
  connecting: 'connecting',
  syncing: 'syncing',
  live: 'live',
  demo: 'demo',
  degraded: 'degraded',
  reauth_required: 'reauth',
};

/** The state a connection is in: the hub's `integrationState` when sent, else the fallback derivation. */
export function stateOfConnection(c: Connection | null, justReturned = false): { state: ProviderState; sub: ProviderSub } {
  if (c?.integrationState) {
    const state = FROM_HUB[c.integrationState];
    if (state === 'not_connected' && justReturned) return { state: 'connecting', sub: null };
    return { state, sub: state === 'not_connected' ? (c.integrationSub ?? null) : null };
  }
  return fallbackState(c, justReturned);
}

export function deriveProviderState(
  provider: Provider,
  conns: readonly Connection[],
  o: DeriveOpts,
): ProviderView {
  const c = primaryConnection(conns);
  const name = NAME[provider];
  const { state, sub } = stateOfConnection(c, o.justReturned === true);
  const active = !!c && c.state !== 'revoked' && state !== 'not_connected' && state !== 'connecting';
  const fixture = !!c && c.mode === 'fixture' && c.state !== 'revoked';
  const items = active ? c!.sources.total : 0;
  const last = active ? c!.lastSyncAt : null;
  const ago = last ? relTime(last, o.now) : null;
  const lastSyncText = last ? `Last synced ${ago}${c!.lastOutcome ? ` (${c!.lastOutcome})` : ''}` : null;
  const askOrReview: [Cta, string | null] =
    items > 0 ? (o.reviewed ? ['ask', 'Ask Cubbie with this'] : ['review', 'Review imported context']) : ['none', null];
  const first = last === null;

  let text: string;
  let cta: Cta = 'none';
  let ctaLabel: string | null = null;
  switch (state) {
    case 'not_connected':
      text = sub === 'disconnected' ? (c?.note ?? `${name} was disconnected and the imported data was deleted.`) : `No ${name} account is connected.`;
      cta = 'connect';
      ctaLabel = `Connect ${name}`;
      break;
    case 'connecting':
      text = `${name} is connecting. Waiting for the connection to be recorded.`;
      break;
    case 'reauth':
      text = `${name} needs you to sign in again. Imported data is kept${ago ? ` (last synced ${ago})` : ''} but may be out of date.`;
      cta = 'reconnect';
      ctaLabel = 'Reconnect';
      break;
    case 'syncing':
      text = first ? `${name} connected. The first sync is running.` : `${name} is syncing again. Last successful sync ${ago}.`;
      [cta, ctaLabel] = askOrReview;
      break;
    case 'degraded':
      text =
        c?.state === 'rate_limited'
          ? `${name} asked Squad to slow down. Retrying automatically; showing the last imported data${ago ? ` (${ago})` : ''}.`
          : `The last ${name} sync failed. Showing the last imported data${ago ? ` (synced ${ago})` : ''}.`;
      cta = 'reconnect';
      ctaLabel = 'Reconnect';
      break;
    default:
      text = ago ? `${name} connected. ${plural(items, 'item')} imported.` : `${name} connected. No sync has completed yet.`;
      [cta, ctaLabel] = askOrReview;
  }
  return {
    provider,
    state,
    sub,
    label: sub ? SUB_WORDS[sub] : STATE_WORDS[state],
    connection: c,
    fixture,
    text,
    cta,
    ctaLabel,
    showConnectPanel: state === 'not_connected',
    showRepair: state === 'degraded' || state === 'reauth',
    hasItems: items > 0,
    firstSyncRunning: state === 'syncing' && first,
    lastSyncText,
    usable: state === 'live' || state === 'syncing' || state === 'demo',
  };
}

/** Home checklist: a real (not fixture) calendar source that is usable. */
export function calendarUsable(conns: readonly Connection[]): boolean {
  return (['google', 'canvas'] as const).some((p) => {
    const list = conns.filter((c) => c.provider === p && (p === 'google' || c.variant === 'feed'));
    const v = deriveProviderState(p, list, { now: 0 });
    return v.usable && v.state !== 'demo' && v.connection?.mode === 'live';
  });
}
