// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ChatMessage, ImessageStatus } from '@squad/core';
import { ImessageIndicator } from './ImessageIndicator';
import { SyncBadge } from './SyncBadge';
import { useImessageStatus } from './useImessageStatus';
import { createFakeChatApi } from '../fixtures';

afterEach(cleanup);
const NOW = 1_700_000_000_000;
const base: ImessageStatus = {
  enabled: true,
  mode: 'live',
  transport: 'ok',
  queued: 2,
  lastSyncAt: NOW - 180_000,
  squads: [{ squadId: 'sq1', name: 'Bio Crew', bound: 1, lastSyncAt: NOW - 180_000 }],
};
const show = (status: ImessageStatus | null, chatId = 'group:sq1') =>
  render(<ImessageIndicator status={status} chatId={chatId} now={() => NOW} />);

describe('ImessageIndicator on a private thread fed by iMessage', () => {
  const dm = (status: ImessageStatus | null) =>
    render(<ImessageIndicator status={status} chatId="dm:s_ana" viaImessage now={() => NOW} />);
  it('is not "Web only": synced, dry run or demo link', () => {
    dm(base);
    expect(screen.getByTestId('chat-imessage-indicator').textContent).toContain('iMessage synced');
    cleanup();
    dm({ ...base, mode: 'dry_run', dryRun: true });
    expect(screen.getByTestId('chat-imessage-indicator').textContent).toContain('dry run');
    cleanup();
    dm({ ...base, mode: 'fixture', fixture: true });
    expect(screen.getByTestId('chat-imessage-indicator').textContent).toContain('iMessage (demo link)');
    cleanup();
    dm(null);
    expect(screen.getByTestId('chat-imessage-indicator').textContent).not.toContain('Web only');
  });
});

describe('ImessageIndicator states', () => {
  it.each([
    ['DM is web only', null, 'dm:s_ana', 'web_only', 'Web only'],
    ['no status is web only', null, 'group:sq1', 'web_only', 'Web only'],
    ['off', { enabled: false }, 'group:sq1', 'not_connected', 'iMessage: not connected (setup)'],
    [
      'unbound',
      { ...base, squads: [{ squadId: 'sq1', name: 'Bio Crew', bound: 0, lastSyncAt: null }] },
      'group:sq1',
      'not_connected',
      'iMessage: not connected (setup)',
    ],
    [
      'dry run',
      { ...base, mode: 'dry_run', dryRun: true },
      'group:sq1',
      'dry_run',
      'iMessage: dry run',
    ],
    [
      'connected',
      base,
      'group:sq1',
      'connected',
      'iMessage: connected to Bio Crew, last sync 3 min ago, 2 queued',
    ],
    [
      'degraded',
      { ...base, transport: 'degraded', degradedReason: 'watcher stopped' },
      'group:sq1',
      'degraded',
      'iMessage: degraded: watcher stopped',
    ],
    [
      'fixture',
      { ...base, mode: 'fixture', fixture: true },
      'group:sq1',
      'fixture',
      'Fixture transport (no real iMessage): connected to Bio Crew, last sync 3 min ago, 2 queued',
    ],
  ] as const)('%s', (_n, status, chatId, state, label) => {
    show(status as ImessageStatus | null, chatId);
    const el = screen.getByTestId('chat-imessage-indicator');
    expect(el.getAttribute('data-state')).toBe(state);
    expect(el.textContent).toContain(label);
    expect(el.getAttribute('aria-label')).toContain(label);
  });
  it('setup link only when setup is needed', () => {
    show({ enabled: false });
    expect(screen.getByTestId('chat-imessage-setup').getAttribute('href')).toBe(
      '/squad/connections#imessage',
    );
    cleanup();
    show(base);
    expect(screen.queryByTestId('chat-imessage-setup')).toBeNull();
  });
});

describe('useImessageStatus', () => {
  it('returns the status from the api', async () => {
    const api = createFakeChatApi();
    api.imessage = base;
    const { result } = renderHook(() => useImessageStatus(api, 1_000_000));
    await waitFor(() => expect(result.current).toEqual(base));
  });
  it('falls back to null on a 404-style null and on a throw', async () => {
    const api = createFakeChatApi();
    const { result } = renderHook(() => useImessageStatus(api, 1_000_000));
    await waitFor(() => expect(result.current).toBeNull());
    const bad = { ...api, imessageStatus: vi.fn().mockRejectedValue(new Error('x')) };
    const r2 = renderHook(() => useImessageStatus(bad, 1_000_000));
    await waitFor(() => expect(bad.imessageStatus).toHaveBeenCalled());
    expect(r2.result.current).toBeNull();
  });
  it('polls', async () => {
    const api = createFakeChatApi();
    const spy = vi.fn(async () => null);
    api.imessageStatus = spy;
    renderHook(() => useImessageStatus(api, 20));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(2));
  });
});

describe('SyncBadge hideVia', () => {
  it('hides the via chip but keeps sender label', () => {
    render(<SyncBadge transport="imessage" senderLabel="•••• 4567" hideVia />);
    expect(screen.queryByText('via iMessage')).toBeNull();
    expect(screen.getByText('•••• 4567')).toBeTruthy();
  });
  it('renders nothing for a hidden via with no other info', () => {
    const { container } = render(<SyncBadge transport="imessage" hideVia />);
    expect(container.firstChild).toBeNull();
  });
});

describe('head source label', () => {
  it('shows via web / via iMessage once per head message', async () => {
    const { MessageBubble } = await import('../Bubble');
    const mk = (transport?: 'web' | 'imessage'): ChatMessage =>
      ({
        id: 'm_1',
        seq: 1,
        chatId: 'group:sq1',
        ts: NOW,
        sender: { kind: 'student', id: 's_ben', name: 'Ben' },
        text: 'hi',
        private: false,
        attachments: [],
        citations: [],
        demo: false,
        ...(transport ? { transport } : {}),
      }) as ChatMessage;
    const row = (m: ChatMessage) =>
      ({
        kind: 'msg',
        key: m.id,
        message: m,
        head: true,
        tail: true,
        own: false,
        state: 'sent',
      }) as never;
    const props = {
      api: null,
      status: null,
      me: 's_ana',
      isNew: false,
      reduced: true,
      onCite: () => {},
      onRetry: () => {},
      onDiscard: () => {},
      quizAnswer: () => undefined,
      onQuizAnswer: async () => true,
      onConfirm: async () => 'ok' as never,
    };
    render(<MessageBubble {...props} row={row(mk('imessage'))} />);
    const l = screen.getByTestId('chat-source-label');
    expect(l.getAttribute('data-source')).toBe('imessage');
    expect(screen.getAllByText('via iMessage')).toHaveLength(1);
    cleanup();
    render(<MessageBubble {...props} row={row(mk())} />);
    expect(screen.getByTestId('chat-source-label').textContent).toBe('via web');
  });
});
