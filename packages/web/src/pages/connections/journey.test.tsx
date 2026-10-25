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
  { id: 's1', kind: 'classroom_coursework', title: 'Problem set 3', sharedWith: [], courseId: 'STAT101', courseName: 'Statistics 101', dueAt: NOW + 86_400_000, startsAt: null, fetchedAt: NOW - 240_000, provenance: 'real' },
  { id: 's2', kind: 'gcal_event', title: 'Office hours', sharedWith: ['sq_1'], courseId: null, dueAt: null, startsAt: NOW + 3_600_000, fetchedAt: NOW - 240_000, provenance: 'fixture' },
];
function props(over: Partial<ViewProps> = {}, client: Partial<HubClient> = {}): ViewProps {
  return {
    view: 'ready',
    connections: [conn()],
    squadId: 'sq_1',
    squadNames: { sq_1: 'Stats 101 Study Squad' },
    error: null,
    client: { sources: async () => rows, ...client } as HubClient,
    clearError: () => {},
    run: async (fn) => fn(client as HubClient),
    userId: 'u1',
    now: NOW,
    ...over,
  };
}
const ui = (p: ViewProps) => render(<MemoryRouter><ConnectionsView {...p} /></MemoryRouter>);
const review = async () => fireEvent.click(await screen.findByTestId('review-imported-context'));

describe('journey: connections', () => {
  it('shows the chosen account (masked e-mail + name) and granted scopes', async () => {
    ui(props());
    expect(screen.getByTestId('conn-account').textContent).toBe('Ana Reyes · a***@gmail.com');
    expect(screen.getByTestId('conn-state').textContent).toBe('Live');
    expect(screen.getByText(/Your calendar events/)).toBeTruthy();
  });
  it('a Canvas session account shows host + signed-in user name', () => {
    ui(
      props({
        connections: [
          conn({
            provider: 'canvas',
            variant: 'session',
            account: { label: 'u_42', name: 'Ana Reyes', host: 'https://canvas.school.edu' },
          }),
        ],
      }),
    );
    expect(screen.getByTestId('conn-account').textContent).toContain('canvas.school.edu');
    expect(screen.getByTestId('conn-account').textContent).toContain('Ana Reyes');
  });
  it('a fixture connection never claims an account', () => {
    ui(props({ connections: [conn({ mode: 'fixture', state: 'fixture' })] }));
    expect(screen.getByTestId('conn-account').textContent).toBe('Demo workspace (simulated)');
    expect(screen.getByTestId('conn-fixture-note').textContent).toMatch(/sample data from the repo/);
    expect(screen.getByTestId('conn-state').textContent).toBe('Demo data');
    expect(screen.getByTestId('conn-fixture-note').textContent).toContain('Fixture (simulated, not your account)');
    expect(screen.getAllByText('Demo data')).toHaveLength(1);
  });
  it('disconnected: no connection means an explicit Disconnected line', () => {
    ui(props({ connections: [] }));
    expect(screen.getByTestId('google-not-connected').textContent).toMatch(/No Google account/);
    expect(screen.getByTestId('canvas-not-connected')).toBeTruthy();
  });
  it('lists imported items with type, course, imported-at, sharing state and labels', async () => {
    ui(props());
    await review();
    const items = await screen.findAllByTestId('imported-item');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('Classroom coursework');
    expect(items[0]!.textContent).toContain('Statistics 101');
    expect(items[0]!.textContent).not.toContain('STAT101');
    expect(items[0]!.textContent).toContain('imported 4 min ago');
    expect(screen.getAllByTestId('item-sharing').map((e) => e.textContent)).toEqual([
      'Private',
      'Shared with Stats 101 Study Squad',
    ]);
    expect(items[1]!.textContent).toContain('Shared with');
    expect(screen.getAllByTestId('ask-cubbie')).toHaveLength(2);
  });
  it('share toggle calls the hub for that one item', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    ui(props({}, { share }));
    await review();
    fireEvent.click((await screen.findAllByTestId('item-share-toggle'))[0]!);
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith('conn_g', {
        squadId: 'sq_1',
        sourceIds: ['s1'],
        shared: true,
      }),
    );
  });
  it('Ask Cubbie queues structured context for the group chat and opens it, prefilled, not sent', async () => {
    const go = vi.fn();
    ui(props({ navigate: go }));
    await review();
    fireEvent.click((await screen.findAllByTestId('ask-cubbie'))[0]!);
    const q = JSON.parse(sessionStorage.getItem(PENDING_CONTEXT_KEY)!);
    expect(q.chatId).toBe('group:sq_1');
    expect(q.sourceIds).toEqual([{ sourceId: 's1' }]);
    expect(q.prefill).toContain('@cubbie');
    expect(go).toHaveBeenCalledWith('/squad/chat?c=group%3Asq_1');
  });
  it('Google authorize carries the served origin, never a hard-coded port', async () => {
    const googleAuthorize = vi
      .fn()
      .mockResolvedValue({ authorization_url: 'https://x', mode: 'live' });
    const go = vi.fn();
    ui(props({ connections: [], navigate: go }, { googleAuthorize }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://x'));
  });
  it('maps account and granted scopes from the hub payload and drops unknown fields', () => {
    const c = toConnection({
      id: 'a',
      provider: 'google',
      mode: 'live',
      status: 'live',
      scopes: ['s'],
      lastSyncAt: null,
      sources: { total: 0, byKind: {} },
      sharedWithSquads: [],
      account: { label: 'a***@x.com' },
      grantedScopes: ['g'],
      secretToken: 'x',
    } as never);
    expect(c.account).toEqual({ label: 'a***@x.com', name: null, host: null });
    expect(c.grantedScopes).toEqual(['g']);
    expect(JSON.stringify(c)).not.toContain('secretToken');
  });
});

describe('journey: panels follow the state machine', () => {
  const Harness = ({ list, client = {} }: { list: Connection[]; client?: Partial<HubClient> }) => (
    <MemoryRouter><ConnectionsView {...props({ connections: list }, client)} /></MemoryRouter>
  );
  it('connect panel disappears after connect and returns after disconnect', () => {
    const { rerender } = render(<Harness list={[]} />);
    expect(screen.getByTestId('connect-google')).toBeTruthy();
    rerender(<Harness list={[conn()]} />);
    expect(screen.queryByTestId('connect-google')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull();
    rerender(<Harness list={[conn({ state: 'revoked', sources: { total: 0, byKind: {} } })]} />);
    expect(screen.getByTestId('connect-google')).toBeTruthy();
    expect(screen.getByTestId('conn-state').textContent).toBe('Disconnected');
  });
  it('reauth and degraded show Reconnect + Disconnect, not the connect panel', () => {
    for (const o of [{ state: 'expired' as const, needsReconnect: true }, { state: 'error' as const }]) {
      const { unmount } = render(<Harness list={[conn(o)]} />);
      expect(screen.getByTestId('reconnect-cta')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
      expect(screen.queryByTestId('connect-google')).toBeNull();
      unmount();
    }
  });
  it('CTA: review first, then Ask Cubbie with this opens the group chat with chips', async () => {
    const go = vi.fn();
    render(<MemoryRouter><ConnectionsView {...props({ navigate: go })} /></MemoryRouter>);
    expect(screen.queryByTestId('ask-cubbie-primary')).toBeNull();
    fireEvent.click(await screen.findByTestId('review-imported-context'));
    fireEvent.click(await screen.findByTestId('ask-cubbie-primary'));
    const q = JSON.parse(sessionStorage.getItem(PENDING_CONTEXT_KEY)!);
    expect(q.sourceIds.length).toBeGreaterThan(0);
    expect(go).toHaveBeenCalledWith('/squad/chat?c=group%3Asq_1');
    expect(screen.getAllByTestId('ask-cubbie').length).toBe(2);
  });
  it('banner never says first sync next to a recent last sync', () => {
    const search = '?provider=google&status=connected';
    render(<MemoryRouter><ConnectionsView {...props({ search })} /></MemoryRouter>);
    const t = screen.getByTestId('oauth-return-text').textContent!;
    expect(t).toContain('Last synced 4 min ago');
    expect(t).not.toMatch(/first sync/i);
  });
  it('banner says first sync is running only while syncing with no successful sync', () => {
    const search = '?provider=google&status=connected';
    render(<MemoryRouter><ConnectionsView {...props({ search, connections: [conn({ syncPhase: 'syncing', lastSyncAt: null, sources: { total: 0, byKind: {} } })] })} /></MemoryRouter>);
    expect(screen.getByTestId('oauth-return-text').textContent).toMatch(/first sync is running/);
  });
  it('demo workspace buttons: Canvas without the extension, Google without an OAuth client', async () => {
    const connectDemo = vi.fn().mockResolvedValue(conn());
    render(<MemoryRouter><ConnectionsView {...props({ connections: [], googleLive: false }, { connectDemo })} /></MemoryRouter>);
    expect(screen.getByTestId('google-no-client').textContent).toContain('GOOGLE_OAUTH_CLIENT_ID');
    fireEvent.click(screen.getByTestId('use-google-demo'));
    fireEvent.click(screen.getByTestId('use-canvas-demo'));
    await waitFor(() => expect(connectDemo).toHaveBeenCalledWith('google'));
    expect(connectDemo).toHaveBeenCalledWith('canvas');
  });
  it('no Google demo button when a real OAuth client exists', () => {
    render(<MemoryRouter><ConnectionsView {...props({ connections: [], googleLive: true })} /></MemoryRouter>);
    expect(screen.queryByTestId('use-google-demo')).toBeNull();
  });
  it('counts use correct plurals', () => {
    render(<MemoryRouter><ConnectionsView {...props({ connections: [conn({ sources: { total: 3, byKind: { classroom_coursework: 1, gcal_event: 2 } } })] })} /></MemoryRouter>);
    expect(screen.getByText('1 Classroom item, 2 calendar events')).toBeTruthy();
  });
});

describe('journey: hub-provided fields', () => {
  it('scope line uses grantedScopeLabels when present, counts use hub counts with plurals', () => {
    ui(props({ connections: [conn({ grantedScopeLabels: ['Calendar (read only)'], counts: { calendarEvents: 1, driveDocs: 2, classroomItems: 1 }, sources: { total: 4, byKind: {} } })] }));
    expect(screen.getByText('Calendar (read only)')).toBeTruthy();
    expect(screen.getByText('1 calendar event, 2 Drive docs, 1 Classroom item')).toBeTruthy();
  });
  it('no course name from the hub means no course text, never the raw id', async () => {
    ui(props());
    fireEvent.click(await screen.findByTestId('review-imported-context'));
    const items = await screen.findAllByTestId('imported-item');
    expect(items[1]!.textContent).not.toMatch(/course/i);
  });
});
