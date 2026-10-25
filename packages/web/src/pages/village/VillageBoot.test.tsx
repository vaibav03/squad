// @vitest-environment jsdom
// Regression: a direct /squad/village load must never sit on a silent blank. Every stage is visible and bounded:
// "Opening the village" -> (8 s) "Still loading the village..." with Retry, still loading -> (45 s) error with Retry.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadWorld = vi.fn<(id: string) => Promise<unknown>>();
vi.mock('./worlds', () => ({
  DEFAULT_WORLD: 'village',
  loadWorld: (id: string) => loadWorld(id),
}));
vi.mock('../../shell/context', () => ({
  useSquadConfig: () => ({ hubUrl: 'http://hub.test', token: 'tok', userId: 'u_1', mode: 'live' }),
}));
vi.mock('../../shell/shell-context', () => ({ useShell: () => ({ setTitle: () => {} }) }));
vi.mock('../../hooks/useCalmMode', () => ({ useCalmMode: () => [false] }));
vi.mock('@squad/village/sources', () => ({
  createLiveSource: () => ({ start: () => new Promise(() => {}), close: () => {} }),
  loadReplay: () => new Promise(() => {}),
  tripCutsceneFromQuery: () => null,
  withTripCutscene: (s: unknown) => s,
}));
vi.mock('@squad/village/inspector', () => ({
  createInspectorStore: () => ({ attach: () => () => {} }),
}));
vi.mock('@squad/village/council', () => ({
  createCouncilBoardStore: () => ({ attach: () => () => {} }),
}));
vi.mock('../../overlays/inspector/bridge', () => ({ setInspectorStore: () => {} }));
vi.mock('../chat/ChatDock', () => ({ ChatDock: () => null }));
vi.mock('../../overlays/room-info', () => ({ RoomLayer: () => null }));
vi.mock('../../overlays/mastery', () => ({ MasteryLayer: () => null }));
vi.mock('../../overlays/inspector', () => ({ InspectorPanel: () => null }));
vi.mock('../../components/source-viewer', () => ({ SourceViewerHost: () => null }));
vi.mock('../../council', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../council')>()),
  CouncilHall: () => null,
  CouncilBoardHost: () => null,
}));
vi.mock('./OverlayHost', () => ({ OverlayHost: () => null }));
vi.mock('../../primitives/Toast', () => ({ useToast: () => ({ toast: () => {} }) }));

import VillagePage, { VILLAGE_LOAD_TIMEOUT_MS, VILLAGE_SLOW_AFTER_MS } from './index';

beforeEach(() => {
  vi.useFakeTimers();
  loadWorld.mockReset();
  loadWorld.mockImplementation(() => new Promise(() => {})); // the engine chunk never arrives
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('village boot is bounded and visible', () => {
  it('says what it is doing, then "Still loading the village..." with Retry, then errors with Retry', async () => {
    render(<VillagePage />);
    expect(screen.getByText(/Opening the village/)).toBeTruthy();
    expect(screen.queryByTestId('slow-note')).toBeNull();

    await act(async () => void vi.advanceTimersByTime(VILLAGE_SLOW_AFTER_MS + 50));
    const note = screen.getByTestId('slow-note');
    expect(note.textContent).toMatch(/Still loading the village\.\.\./);
    expect(screen.getByText(/Opening the village/)).toBeTruthy(); // still loading, not given up
    expect(screen.queryByRole('alert')).toBeNull();

    await act(
      async () => void vi.advanceTimersByTime(VILLAGE_LOAD_TIMEOUT_MS - VILLAGE_SLOW_AFTER_MS),
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/did not load/i);
    expect(alert.textContent).toMatch(/taking too long/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('Retry (from the slow note or the error) starts the load again', async () => {
    render(<VillagePage />);
    await act(async () => void vi.advanceTimersByTime(VILLAGE_SLOW_AFTER_MS + 50));
    const before = loadWorld.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(loadWorld.mock.calls.length).toBeGreaterThan(before);
    expect(screen.queryByTestId('slow-note')).toBeNull(); // the clock restarted
    expect(screen.getByText(/Opening the village/)).toBeTruthy();
  });

  it('a world that fails to start ends in an error with Retry immediately', async () => {
    loadWorld.mockRejectedValue(new Error('chunk'));
    render(<VillagePage />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    expect(screen.getByRole('alert').textContent).toMatch(/could not start/i);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
