// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectionsView, type ViewProps } from './ConnectionsView';
import { toConnection, type Connection, type HubClient, type SourceRow } from './api';
import { PENDING_CONTEXT_KEY } from './askCubbie';

afterEach(cleanup);
beforeEach(() => sessionStorage.clear());

const NOW = 1_700_000_000_000;
const conn = (o: Partial<Connection> = {}): Connection => ({
  id: 'conn_g',
  provider: 'google',
  variant: 'oauth',
  mode: 'live',
  state: 'live',
  stateLabel: 'Connected',
  retryAfter: null,
  syncPhase: 'idle',
  cursor: null,
  lastOutcome: null,
  note: null,
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  lastSyncAt: NOW - 240_000,
  canSync: true,
  syncVia: 'hub',
  sources: { total: 2, byKind: { gcal_event: 1, classroom_coursework: 1 } },
  sharedWithSquads: [],
  needsReconnect: false,
  account: { label: 'a***@gmail.com', name: 'Ana Reyes', host: null },
  grantedScopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  ...o,
});
const rows: SourceRow[] = [
  { id: 's1', kind: 'classroom_coursework', title: 'Problem set 3', sharedWith: [], courseId: 'STAT101', dueAt: NOW + 86_400_000, startsAt: null, fetchedAt: NOW - 240_000, provenance: 'real' },
  { id: 's2', kind: 'gcal_event', title: 'Office hours', sharedWith: ['sq_1'], courseId: null, dueAt: null, startsAt: NOW + 3_600_000, fetchedAt: NOW - 240_000, provenance: 'fixture' },
];
function props(over: Partial<ViewProps> = {}, client: Partial<HubClient> = {}): ViewProps {
  return {
    view: 'ready', connections: [conn()], squadId: 'sq_1', squadNames: { sq_1: 'Stats 101 Study Squad' }, error: null,
    client: { sources: async () => rows, ...client } as HubClient, clearError: () => {},
    run: async (fn) => fn(client as HubClient), userId: 'u1', now: NOW, ...over,
  };
}
const ui = (p: ViewProps) => render(<MemoryRouter><ConnectionsView {...p} /></MemoryRouter>);

describe('journey: connections', () => {
  it('shows the chosen account (masked e-mail + name) and granted scopes', async () => {
    ui(props());
    expect(screen.getByTestId('conn-account').textContent).toBe('Ana Reyes · a***@gmail.com');
    expect(screen.getByText('Real account')).toBeTruthy();
    expect(screen.getByText(/Your calendar events/)).toBeTruthy();
  });
  it('a Canvas session account shows host + signed-in user name', () => {
    ui(props({ connections: [conn({ provider: 'canvas', variant: 'session', account: { label: 'u_42', name: 'Ana Reyes', host: 'https://canvas.school.edu' } })] }));
    expect(screen.getByTestId('conn-account').textContent).toContain('canvas.school.edu');
    expect(screen.getByTestId('conn-account').textContent).toContain('Ana Reyes');
  });
  it('a fixture connection never claims an account', () => {
    ui(props({ connections: [conn({ mode: 'fixture', state: 'fixture' })] }));
    expect(screen.getByTestId('conn-account').textContent).toMatch(/simulated data, not your account/);
    expect(screen.getAllByText('Fixture (simulated, not your account)').length).toBeGreaterThan(0);
  });
  it('disconnected: no connection means an explicit Disconnected line', () => {
    ui(props({ connections: [] }));
    expect(screen.getByTestId('google-not-connected').textContent).toMatch(/No Google account/);
    expect(screen.getByTestId('canvas-not-connected')).toBeTruthy();
  });
  it('lists imported items with type, course, imported-at, sharing state and labels', async () => {
    ui(props());
    const items = await screen.findAllByTestId('imported-item');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Classroom coursework');
    expect(items[0]!.textContent).toContain('STAT101');
    expect(items[0]!.textContent).toContain('imported 4 min ago');
    expect(screen.getAllByTestId('item-sharing').map((e) => e.textContent)).toEqual([
      'Private',
      'Shared with Stats 101 Study Squad',
    ]);
    expect(items[1]!.textContent).toContain('Fixture (simulated, not your account)');
    expect(screen.getAllByTestId('ask-cubbie')).toHaveLength(2);
  });
  it('share toggle calls the hub for that one item', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    ui(props({}, { share }));
    fireEvent.click((await screen.findAllByTestId('item-share-toggle'))[0]!);
    await waitFor(() => expect(share).toHaveBeenCalledWith('conn_g', { squadId: 'sq_1', sourceIds: ['s1'], shared: true }));
  });
  it('Ask Cubbie queues structured context for the group chat and opens it, prefilled, not sent', async () => {
    const go = vi.fn();
    ui(props({ navigate: go }));
    fireEvent.click((await screen.findAllByTestId('ask-cubbie'))[0]!);
    const q = JSON.parse(sessionStorage.getItem(PENDING_CONTEXT_KEY)!);
    expect(q.chatId).toBe('group:sq_1');
    expect(q.sourceIds).toEqual([{ sourceId: 's1' }]);
    expect(q.prefill).toContain('@cubbie');
    expect(go).toHaveBeenCalledWith('/squad/chat?c=group%3Asq_1');
  });
  it('Google authorize carries the served origin, never a hard-coded port', async () => {
    const googleAuthorize = vi.fn().mockResolvedValue({ authorization_url: 'https://x', mode: 'live' });
    const go = vi.fn();
    ui(props({ connections: [], navigate: go }, { googleAuthorize }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Google' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://x'));
  });
  it('maps account and granted scopes from the hub payload and drops unknown fields', () => {
    const c = toConnection({ id: 'a', provider: 'google', mode: 'live', status: 'live', scopes: ['s'], lastSyncAt: null, sources: { total: 0, byKind: {} }, sharedWithSquads: [], account: { label: 'a***@x.com' }, grantedScopes: ['g'], secretToken: 'x' } as never);
    expect(c.account).toEqual({ label: 'a***@x.com', name: null, host: null });
    expect(c.grantedScopes).toEqual(['g']);
    expect(JSON.stringify(c)).not.toContain('secretToken');
  });
});
