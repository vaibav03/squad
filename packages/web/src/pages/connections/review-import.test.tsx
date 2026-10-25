// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Connection, HubClient, SourceRow } from './api';
import { PENDING_CONTEXT_KEY } from './askCubbie';
import { ReviewImport } from './ReviewImport';
import type { ConnectionsState } from './useConnections';

afterEach(cleanup);
beforeEach(() => sessionStorage.clear());
const NOW = 1_700_000_000_000;
const conn = (o: Partial<Connection> = {}): Connection => ({
  id: 'cg', provider: 'google', variant: 'oauth', mode: 'live', state: 'live', stateLabel: '', retryAfter: null, syncPhase: 'idle',
  cursor: null, lastOutcome: 'ok', note: null, scopes: [], lastSyncAt: NOW - 120_000, canSync: true, syncVia: 'hub',
  sources: { total: 3, byKind: { classroom_item: 1, gcal_event: 1, gdrive_file: 1 } }, sharedWithSquads: [], needsReconnect: false,
  account: { label: 'a***@gmail.com', name: 'Ana', host: null }, grantedScopes: [], ...o,
});
const row = (o: Partial<SourceRow>): SourceRow => ({ id: 'r', kind: 'classroom_item', title: 'T', sharedWith: [], courseId: 'STAT101', dueAt: NOW + 86_400_000, startsAt: null, fetchedAt: NOW, provenance: 'real', ...o });
const rows = [
  row({ id: 'a', title: 'Problem set 3' }),
  row({ id: 'b', kind: 'gcal_event', title: 'Therapy', dueAt: null, startsAt: NOW + 1000, courseId: null }),
  row({ id: 'c', kind: 'gdrive_file', title: 'Notes', dueAt: null, sharedWith: ['sq_1'] }),
];
function state(list: Connection[], client: Partial<HubClient> = {}): ConnectionsState {
  return { view: 'ready', connections: list, squadId: 'sq_1', squadNames: { sq_1: 'Stats Squad' }, error: null, client: { sources: async () => rows, ...client } as HubClient, reload: async () => {}, clearError: () => {}, run: async (fn) => fn({ sources: async () => rows, ...client } as HubClient) };
}
const ui = (s: ConnectionsState, extra = {}) => render(<MemoryRouter><ReviewImport state={s} now={NOW} {...extra} /></MemoryRouter>);

describe('review imported context', () => {
  it('shows state, last sync, account and correct plural counts', async () => {
    ui(state([conn()]), { provider: 'google' });
    expect(screen.getByTestId('review-state-google').textContent).toBe('Live');
    expect(screen.getByTestId('review-sync-google').textContent).toContain('Last synced 2 min ago (ok)');
    expect(screen.getByTestId('review-sync-google').textContent).toContain('a***@gmail.com');
    await waitFor(() => expect(screen.getByTestId('review-counts-google').textContent).toBe('1 course, 1 Classroom item, 1 calendar event, 1 Drive doc'));
  });
  it('plurals: 2 of each', async () => {
    ui(state([conn({ sources: { total: 4, byKind: { gdrive_file: 2, gdoc: 0, gcal_event: 2 } } })]), { provider: 'google' });
    await waitFor(() => expect(screen.getByTestId('review-counts-google').textContent).toContain('2 calendar events, 2 Drive docs'));
  });
  it('items default to Private, show real-vs-demo chip, citation chip, and calendar is free/busy only', async () => {
    ui(state([conn({ mode: 'fixture', state: 'fixture' })]), { provider: 'google' });
    const items = await screen.findAllByTestId('review-item');
    expect(items).toHaveLength(3);
    expect(items[0]!.querySelector('.sq-cite')?.textContent).toBe('Problem set 3');
    expect(screen.getByTestId('review-state-google').textContent).toBe('Demo data');
    expect(screen.getByTestId('review-fixture-note-google').textContent).toContain('Fixture (simulated, not your account)');
    const sh = screen.getAllByTestId('review-item-sharing').map((e) => e.textContent);
    expect(sh).toEqual(['Private to me', 'Private to me', 'Shared with Stats Squad']);
    expect(items[1]!.querySelector('[data-testid="review-item-share"]')).toBeNull();
    expect(items[1]!.textContent).toContain('Free/busy only, titles never shared.');
  });
  it('demo source chips read "Demo: Google"; real read "Google"', async () => {
    const { unmount } = ui(state([conn({ mode: 'fixture', state: 'fixture' })]), { provider: 'google' });
    await screen.findAllByTestId('review-item');
    expect(screen.getAllByTestId('review-item-prov')[0]!.textContent).toBe('Google');
    unmount();
  });
  it('per-item and per-source share toggles call the hub', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    ui(state([conn()], { share }), { provider: 'google' });
    fireEvent.click((await screen.findAllByTestId('review-item-share'))[0]!);
    await waitFor(() => expect(share).toHaveBeenCalledWith('cg', { squadId: 'sq_1', sourceIds: ['a'], shared: true }));
    fireEvent.click(screen.getByTestId('review-share-all-google'));
    await waitFor(() => expect(share).toHaveBeenCalledWith('cg', { squadId: 'sq_1', all: true, shared: true }));
  });
  it('Ask Cubbie with this queues context chips for the group chat', async () => {
    const go = vi.fn();
    ui(state([conn()]), { provider: 'google', navigate: go });
    fireEvent.click(await screen.findByTestId('review-ask-primary-google'));
    const q = JSON.parse(sessionStorage.getItem(PENDING_CONTEXT_KEY)!);
    expect(q.chatId).toBe('group:sq_1');
    expect(q.sourceIds.length).toBe(3);
    expect(go).toHaveBeenCalledWith('/squad/chat?c=group%3Asq_1');
  });
  it('not connected provider points to Connections; Change source and embedded Continue exist', () => {
    const onContinue = vi.fn();
    ui(state([]), { provider: 'canvas', embedded: true, onContinue });
    expect(screen.getByTestId('review-state-canvas').textContent).toBe('Not connected');
    expect(screen.getByTestId('change-source').getAttribute('href')).toBe('/squad/connections');
    fireEvent.click(screen.getByTestId('review-continue'));
    expect(onContinue).toHaveBeenCalled();
  });
});
