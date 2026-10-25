// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BuildMarker, BuildMarkerView } from './BuildMarker';
import { LiveConfigProvider } from '../overlays/kit/live-config';
import { formatBuiltAt, isStaleBuild } from '../lib/build';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('isStaleBuild', () => {
  it('flags different commits only when both are known', () => {
    expect(isStaleBuild('aaaaaaaaaaaa', 'bbbbbbbbbbbb')).toBe(true);
    expect(isStaleBuild('aaaaaaaaaaaa', 'aaaaaaaaaaaa')).toBe(false);
    expect(isStaleBuild('aaaaaaa', 'aaaaaaaaaaaa')).toBe(false); // short vs long form of one commit
    expect(isStaleBuild('unknown', 'bbbbbbbbbbbb')).toBe(false);
    expect(isStaleBuild('aaaaaaaaaaaa', undefined)).toBe(false);
  });
  it('formats the build time', () => {
    expect(formatBuiltAt('2026-10-25T04:12:59.000Z')).toBe('2026-10-25 04:12 UTC');
    expect(formatBuiltAt('nope')).toBe('');
  });
});

describe('BuildMarkerView', () => {
  it('shows web sha, build time and hub sha without a warning when they match', () => {
    render(
      <BuildMarkerView
        webSha="abc123abc123"
        webBuiltAt="2026-10-25T04:12:00Z"
        hub={{ gitSha: 'abc123abc123', version: '0.1.0' }}
      />,
    );
    const m = screen.getByTestId('build-marker');
    expect(m).toHaveTextContent('web abc123abc123');
    expect(m).toHaveTextContent('built 2026-10-25 04:12 UTC');
    expect(m).toHaveTextContent('hub abc123abc123 v0.1.0');
    expect(screen.queryByText(/Stale build/)).toBeNull();
  });
  it('warns visibly when the web sha differs from the hub sha', () => {
    render(<BuildMarkerView webSha="aaaaaaaaaaaa" hub={{ gitSha: 'bbbbbbbbbbbb' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Stale build/);
    expect(screen.getByRole('status')).toHaveTextContent('aaaaaaaaaaaa');
    expect(screen.getByRole('status')).toHaveTextContent('bbbbbbbbbbbb');
  });
  it('shows only the web build while the hub is unknown', () => {
    render(<BuildMarkerView webSha="aaaaaaaaaaaa" />);
    expect(screen.getByTestId('build-marker')).toHaveTextContent('web aaaaaaaaaaaa');
    expect(screen.queryByText(/Stale build/)).toBeNull();
  });
});

describe('BuildMarker (live)', () => {
  it('reads the hub /v1/status gitSha and version', async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      Response.json({ version: '9.9.9', gitSha: 'feedfacefeed', builtAt: '2026-10-25T00:00:00Z' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LiveConfigProvider value={{ mode: 'live', hubUrl: 'http://hub.test', userId: 'u' }}>
        <BuildMarker />
      </LiveConfigProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('build-marker')).toHaveTextContent('hub feedfacefeed v9.9.9'),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://hub.test/v1/status');
  });
  it('does not call the hub in mock mode', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<BuildMarker />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('build-marker')).toBeInTheDocument();
  });
});
