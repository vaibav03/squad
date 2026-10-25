// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConnectionsView, type ViewProps } from './ConnectionsView';
import { toConnection, type Connection, type HubClient } from './api';
import { errorCopy, oauthReturn, STATES } from './model';
import { EXT_ATTR, MSG, extensionPresent, onExtensionReady } from './bridge';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(EXT_ATTR);
});

const NOW = 1_700_000_000_000;
const conn = (o: Partial<Connection> = {}): Connection => ({
  id: 'conn_1',
  provider: 'canvas',
  variant: 'session',
  mode: 'live',
  state: 'live',
  stateLabel: 'Connected',
  retryAfter: null,
  syncPhase: 'idle',
  cursor: null,
  lastOutcome: null,
  note: null,
  scopes: ['canvas.browser_session.read'],
  lastSyncAt: NOW - 120_000,
  canSync: false,
  syncVia: 'extension',
  sources: { total: 3, byKind: { canvas_assignment: 2, canvas_file: 1 } },
  sharedWithSquads: [],
  needsReconnect: false,
  ...o,
});
function props(over: Partial<ViewProps> = {}, client: Partial<HubClient> = {}): ViewProps {
  return {
    view: 'ready',
    connections: [],
    squadId: 'sq_1',
    squadNames: { sq_1: 'Stats 101 Study Squad' },
    error: null,
    client: client as HubClient,
    clearError: () => {},
    run: async (fn) => fn(client as HubClient),
    userId: 'u1',
    now: NOW,
    ...over,
  };
}

describe('state badges', () => {
  it.each(STATES)('renders honest badge for %s', (state) => {
    render(
      <ConnectionsView
        {...props({
          connections: [
            conn({
              state,
              stateLabel: `label-${state}`,
              mode: state === 'fixture' ? 'fixture' : 'live',
              retryAfter: NOW + 60_000,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText(`label-${state}`)).toBeTruthy();
    if (state === 'fixture') expect(screen.getByText('Demo data, not a real account')).toBeTruthy();
    else expect(screen.queryByText('Demo data, not a real account')).toBeNull();
    if (state === 'rate_limited') expect(screen.getByText(/Will retry in/)).toBeTruthy();
  });
  it('derives state when the hub has not sent one yet', () => {
    const c = toConnection({
      id: 'a',
      provider: 'google',
      mode: 'fixture',
      status: 'live',
      scopes: [],
      lastSyncAt: null,
      sources: { total: 0, byKind: {} },
      sharedWithSquads: [],
    });
    expect(c.state).toBe('fixture');
  });
  it('shows counts, last sync, sharing and plain-word scopes, syncing phase', () => {
    render(
      <ConnectionsView
        {...props({
          connections: [conn({ syncPhase: 'syncing', sharedWithSquads: ['sq_9'] })],
          squadNames: { sq_9: 'Bio Crew' },
        })}
      />,
    );
    expect(screen.getByText('Syncing')).toBeTruthy();
    expect(screen.getByText('2 min ago')).toBeTruthy();
    expect(screen.getByText('2 assignments, 1 files')).toBeTruthy();
    expect(screen.getByText('Bio Crew')).toBeTruthy();
    expect(screen.getByText(/through your own browser session/)).toBeTruthy();
  });
});

describe('actions', () => {
  it('disconnect asks for confirmation, then shows purge counts', async () => {
    const disconnect = vi.fn().mockResolvedValue({ sources: 3, chunks: 7 });
    render(<ConnectionsView {...props({ connections: [conn()] }, { disconnect })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Delete 3 imported items/ }));
    await waitFor(() =>
      expect(screen.getByText(/Deleted 3 sources and 7 text excerpts/)).toBeTruthy(),
    );
    expect(disconnect).toHaveBeenCalledWith('conn_1');
  });
  it('session connections sync from the extension; hub connections sync now', () => {
    const sync = vi.fn().mockResolvedValue(conn());
    render(
      <ConnectionsView
        {...props(
          {
            connections: [
              conn(),
              conn({
                id: 'g',
                provider: 'google',
                variant: 'oauth',
                canSync: true,
                syncVia: 'hub',
              }),
            ],
          },
          { sync },
        )}
      />,
    );
    const [a, b] = screen.getAllByRole('button', { name: 'Sync now' });
    expect((a as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/syncs from the browser extension/)).toBeTruthy();
    fireEvent.click(b!);
    expect(sync).toHaveBeenCalledWith('g');
  });
  it('shares all non-calendar sources with the active squad', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionsView {...props({ connections: [conn()] }, { share })} />);
    fireEvent.click(screen.getByRole('button', { name: /Share all non-calendar/ }));
    expect(share).toHaveBeenCalledWith('conn_1', { squadId: 'sq_1', all: true, shared: true });
  });
  it('expired connection offers reconnect; revoked offers remove', () => {
    render(
      <ConnectionsView
        {...props({
          connections: [
            conn({ state: 'expired', needsReconnect: true }),
            conn({ id: 'r', state: 'revoked', needsReconnect: true }),
          ],
        })}
      />,
    );
    expect(screen.getAllByRole('button', { name: 'Reconnect' }).length).toBe(2);
    expect(screen.getByRole('button', { name: 'Remove from list' })).toBeTruthy();
  });
  it('google button navigates to the authorization url the hub returns', async () => {
    const googleAuthorize = vi
      .fn()
      .mockResolvedValue({ authorization_url: 'https://accounts.example/auth', mode: 'live' });
    const navigate = vi.fn();
    render(<ConnectionsView {...props({ navigate }, { googleAuthorize })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://accounts.example/auth'));
    expect(googleAuthorize).toHaveBeenCalledWith('/squad/connections');
    expect(screen.getByText(/only busy times unless you/)).toBeTruthy();
  });
  it('shows the one-time pairing code', async () => {
    const pair = vi.fn().mockResolvedValue({ code: 'ABCD-1234', expiresAt: NOW + 600_000 });
    render(<ConnectionsView {...props({}, { pair })} />);
    fireEvent.click(screen.getByRole('button', { name: /pairing code/ }));
    await waitFor(() => expect(screen.getByText('ABCD-1234')).toBeTruthy());
  });
});

describe('errors and states of the page', () => {
  it('maps bridge and hub error codes to honest copy', () => {
    for (const code of [
      'canvas_account_already_bound',
      'canvas_account_conflict',
      'canvas_origin_not_allowed',
      'squad_not_signed_in',
      'squad_account_mismatch',
      'canvas_session_changed',
    ])
      expect(errorCopy(code)).not.toBe(errorCopy('unknown_code'));
    render(<ConnectionsView {...props({ error: 'canvas_account_already_bound' })} />);
    expect(screen.getByText(/already connected to another Squad account/)).toBeTruthy();
  });
  it('reads the oauth return params', () => {
    expect(oauthReturn('?provider=gmail&status=connected')).toEqual({
      provider: 'gmail',
      ok: true,
      message: null,
    });
    const m = btoa('google_connection_failed').replace(/=+$/, '');
    expect(oauthReturn(`?status=error&message=${m}`)?.message).toBe('google_connection_failed');
    expect(oauthReturn('')).toBeNull();
  });
  it('demo and offline are explicit', () => {
    render(<ConnectionsView {...props({ view: 'demo', client: null })} />);
    expect(screen.getByText('Demo mode')).toBeTruthy();
    cleanup();
    render(<ConnectionsView {...props({ view: 'offline' })} />);
    expect(screen.getByText('Cannot reach the hub')).toBeTruthy();
  });
  it('never renders secret-shaped fields the hub should not send', () => {
    const c = toConnection({
      id: 'a',
      provider: 'canvas',
      mode: 'live',
      status: 'live',
      scopes: [],
      lastSyncAt: null,
      sources: { total: 0, byKind: {} },
      sharedWithSquads: [],
      feedUrl: 'https://canvas.example/feed/SECRET-SENTINEL',
      token: 'SECRET-SENTINEL',
      accessToken: 'SECRET-SENTINEL',
    } as never);
    expect(JSON.stringify(c)).not.toContain('SECRET-SENTINEL');
    render(<ConnectionsView {...props({ connections: [c] })} />);
    expect(document.body.innerHTML).not.toContain('SECRET-SENTINEL');
  });
});

describe('extension detection and bridge', () => {
  it('detects the marker attribute and the ready event', () => {
    expect(extensionPresent()).toBe(false);
    const cb = vi.fn();
    const off = onExtensionReady(cb);
    document.dispatchEvent(new CustomEvent(MSG.ready));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    document.documentElement.setAttribute(EXT_ATTR, '1');
    expect(extensionPresent()).toBe(true);
  });
  it('without the extension says so; with it lists detected Canvas accounts and authorizes', async () => {
    render(<ConnectionsView {...props()} />);
    expect(screen.getByText('Extension not detected')).toBeTruthy();
    cleanup();
    document.documentElement.setAttribute(EXT_ATTR, '1');
    const seen: unknown[] = [];
    window.addEventListener('message', (e) => {
      const d = e.data as { type?: string; requestId?: string; message?: { type: string } };
      if (d?.type !== MSG.request) return;
      seen.push(d.message);
      const response =
        d.message?.type === MSG.status
          ? {
              ok: true,
              accounts: [{ origin: 'https://canvas.school.test', canvasUserId: '7', name: 'Ana' }],
              squadUserId: 'u1',
              sync: null,
            }
          : { ok: false, error: 'canvas_account_conflict' };
      window.postMessage(
        { type: MSG.response, requestId: d.requestId, response },
        window.location.origin,
      );
    });
    render(<ConnectionsView {...props()} />);
    await waitFor(() =>
      expect(screen.getByText(/Ana on https:\/\/canvas.school.test/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Connect this account' }));
    await waitFor(() => expect(screen.getByText(/different Canvas login/)).toBeTruthy());
    expect(seen).toContainEqual(
      expect.objectContaining({ type: MSG.authorize, canvasUserId: '7', userId: 'u1' }),
    );
  });
});

const RAW =
  /\b[us]_[0-9a-f]{6,}\b|\bsq_[a-z0-9_]{3,}\b|\b[0-9a-f]{24,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/** Every rendered text node and every aria-label / title / alt / placeholder under the body. */
function scan(): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n.textContent ?? '');
  document.body.querySelectorAll('*').forEach((el) => {
    for (const a of ['aria-label', 'title', 'alt', 'placeholder'])
      if (el.hasAttribute(a)) out.push(el.getAttribute(a) ?? '');
  });
  return out;
}

describe('Shared with shows squad names, never raw ids (S2)', () => {
  const shared = (id: string) =>
    conn({ provider: 'google', variant: 'oauth', syncVia: 'hub', sharedWithSquads: [id] });
  it('resolves ids through the roster', () => {
    render(<ConnectionsView {...props({ connections: [shared('sq_1')] })} />);
    expect(screen.getByText('Stats 101 Study Squad')).toBeTruthy();
  });
  it.each([
    ['a known squad', 'sq_a193aba6d4e4', { sq_a193aba6d4e4: 'Bio Crew' }],
    ['a squad the roster does not know', 'sq_9f3c0a7be211', {}],
    ['a long hex id', 'a193aba6d4e49f3c0a7be211a193aba6d4e4', {}],
  ])('no raw ids anywhere on the page: %s', (_n, id, names) => {
    render(
      <ConnectionsView {...props({ connections: [shared(id)], squadId: id, squadNames: names })} />,
    );
    for (const t of scan()) expect(t).not.toMatch(RAW);
  });
});

describe('revoked / expired grants offer Reconnect with an honest message (V3, V4)', () => {
  it('revoked: states the purge in words and shows Reconnect', () => {
    const msg = 'Google access was revoked. Imported data was removed. Reconnect to import again.';
    render(
      <ConnectionsView
        {...props({
          connections: [
            conn({
              provider: 'google',
              variant: 'oauth',
              syncVia: 'hub',
              state: 'revoked',
              stateLabel: msg,
              note: msg,
              needsReconnect: true,
              sources: { total: 0, byKind: {} },
            }),
          ],
        })}
      />,
    );
    expect(screen.getAllByText(msg)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });
  it('expired: keeps the data, flags it, shows Reconnect', () => {
    render(
      <ConnectionsView
        {...props({
          connections: [
            conn({
              provider: 'google',
              variant: 'oauth',
              syncVia: 'hub',
              state: 'expired',
              stateLabel: 'Expired: reconnect to resume syncing',
              needsReconnect: true,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });
});
