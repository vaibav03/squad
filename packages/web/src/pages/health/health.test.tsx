// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { HealthReport } from '@squad/core';
import { HealthSummary } from './HealthSummary';
import { useHealth } from './useHealth';
import HealthRedirect from './index';
import { HealthBanner } from './HealthBanner';

const state = vi.hoisted(() => ({ cfg: { mode: 'live', hubUrl: 'http://hub', token: 't' } }));
vi.mock('../../shell/context', () => ({ useSquadConfig: () => state.cfg }));
vi.mock('../../shell/shell-context', () => ({ useShell: () => ({ setTitle: () => {} }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const T = 1_700_000_000_000;
const report = (checks: HealthReport['checks']): HealthReport => ({
  generatedAt: T,
  overall: checks.some((c) => c.status === 'fail') ? 'fail' : 'pass',
  servedOrigin: 'http://localhost:5290',
  checks,
});
const mk = (
  id: string,
  group: HealthReport['checks'][number]['group'],
  status: HealthReport['checks'][number]['status'],
  extra = {},
) => ({
  id,
  group,
  label: id,
  status,
  reason: `reason-${id}`,
  probedAt: T,
  ...extra,
});
const mockFetch = (r: HealthReport | number) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      typeof r === 'number' ? new Response('{}', { status: r }) : new Response(JSON.stringify(r)),
    );
const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);
function Summary() {
  return <HealthSummary health={useHealth()} />;
}
function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.hash}</p>;
}

describe('health page', () => {
  it('renders each link with status, reason, fix, fixture label and missing env', async () => {
    mockFetch(
      report([
        mk('canvas_connected', 'canvas', 'pass', { mode: 'fixture' }),
        mk('google_connected', 'google', 'blocked', {
          missingEnv: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
        }),
        mk('redirect_origin', 'google', 'fail', {
          fix: { label: 'Open Connections', to: '/squad/connections' },
        }),
        mk('context_retrievable', 'chain', 'warn'),
        mk('sendblue_outbound', 'sendblue', 'blocked', { missingEnv: ['SENDBLUE_API_KEY'] }),
      ]),
    );
    wrap(<Summary />);
    await screen.findByTestId('health-check-canvas_connected');
    await screen.findByTestId('health-check-canvas_connected');
    expect(screen.getByTestId('health-status-canvas_connected').textContent).toBe('Pass');
    expect(screen.getByTestId('health-check-canvas_connected').textContent).toContain(
      'Demo data (not your account)',
    );
    expect(screen.getByTestId('health-status-google_connected').textContent).toBe('BLOCKED');
    expect(screen.getByTestId('health-check-google_connected').textContent).toContain(
      'GOOGLE_OAUTH_CLIENT_SECRET',
    );
    expect(screen.getByTestId('health-status-redirect_origin').textContent).toBe('Fail');
    expect(screen.getByTestId('health-fix-redirect_origin').textContent).toBe('Open Connections');
    expect(screen.getByTestId('health-overall').textContent).toBe('Overall: Fail');
    // the technical detail is collapsed by default
    expect(screen.getByTestId('health-details').hasAttribute('open')).toBe(false);
    expect(screen.getByText('http://localhost:5290', { exact: false })).toBeTruthy();
  });
  it('Re-run asks the hub again (real probes, no cache)', async () => {
    const f = mockFetch(report([mk('a', 'chain', 'pass')]));
    wrap(<Summary />);
    await screen.findByTestId('health-check-a');
    const before = f.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /^Re-run/ }));
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThan(before));
    expect(f.mock.calls[0]![0]).toBe('http://hub/v1/connections/health');
  });
  it('an unreachable health endpoint is an error, never a pass', async () => {
    mockFetch(500);
    wrap(<Summary />);
    expect(await screen.findByText('The connection check did not answer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByTestId('health-overall')).toBeNull();
  });
  it('demo mode probes nothing', () => {
    state.cfg = { mode: 'demo', hubUrl: '', token: '' } as never;
    const f = mockFetch(500);
    wrap(<Summary />);
    expect(screen.queryByTestId('health-page')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    state.cfg = { mode: 'live', hubUrl: 'http://hub', token: 't' };
  });
});

describe('health banner', () => {
  it('shows on a fail, hidden when healthy, warn only for core chain groups', async () => {
    mockFetch(report([mk('redirect_origin', 'google', 'fail')]));
    wrap(<HealthBanner />);
    expect((await screen.findByTestId('health-banner')).textContent).toContain(
      '1 connection problem',
    );
    cleanup();
    mockFetch(report([mk('a', 'chain', 'pass'), mk('x', 'sendblue', 'warn')]));
    wrap(<HealthBanner />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('health-banner')).toBeNull();
    cleanup();
    mockFetch(report([mk('c', 'chain', 'warn')]));
    wrap(<HealthBanner />);
    expect(await screen.findByTestId('health-banner')).toBeTruthy();
  });
  it('says so when the health endpoint is unreachable', async () => {
    mockFetch(503);
    wrap(<HealthBanner />);
    expect((await screen.findByTestId('health-banner')).textContent).toContain(
      'unknown, not healthy',
    );
  });
});

describe('customer summary', () => {
  it('says Everything works when every group is fine', async () => {
    mockFetch(
      report([
        mk('canvas_connected', 'canvas', 'pass', { mode: 'extension' }),
        mk('google_connected', 'google', 'pass', { mode: 'real' }),
        mk('model_provider', 'platform', 'pass', { mode: 'live' }),
        mk('items_visible', 'chain', 'pass'),
        mk('imessage_bridge', 'platform', 'pass', { mode: 'live' }),
      ]),
    );
    wrap(<Summary />);
    expect((await screen.findByTestId('health-headline')).textContent).toBe('Everything works');
  });
  it('counts what needs attention, uses plain labels and deep-links each fix to its card', async () => {
    mockFetch(
      report([
        mk('canvas_connected', 'canvas', 'warn', { mode: 'extension not detected' }),
        mk('google_connected', 'google', 'blocked', {
          mode: 'not connected',
          missingEnv: ['GOOGLE_OAUTH_CLIENT_ID'],
        }),
        mk('redirect_origin', 'google', 'warn'),
        mk('model_provider', 'platform', 'warn', { mode: 'fixture' }),
        mk('sendblue_outbound', 'sendblue', 'blocked', { missingEnv: ['SENDBLUE_API_KEY'] }),
      ]),
    );
    wrap(<Summary />);
    const head = await screen.findByTestId('health-headline');
    expect(head.textContent).toBe('3 things need attention');
    const canvas = screen.getByTestId('health-group-canvas');
    expect(canvas.textContent).toContain('Not connected');
    expect(canvas.querySelector('a')!.getAttribute('href')).toMatch(/#canvas$/);
    expect(
      screen.getByTestId('health-group-google').querySelector('a')!.getAttribute('href'),
    ).toMatch(/#google$/);
    expect(
      screen.getByTestId('health-group-messaging').querySelector('a')!.getAttribute('href'),
    ).toMatch(/#messaging$/);
    expect(screen.getByTestId('health-group-answers').textContent).toContain('Practice mode');
    // no jargon in the customer card: setting names and check ids live only in the collapsed details
    const card = head.closest('[class*="sq-health__card"]')!.textContent!;
    expect(card).not.toMatch(/GOOGLE_|SENDBLUE_|redirect|webhook|origin|_connected/i);
  });
  it('a demo connection reads Demo data, never Live', async () => {
    mockFetch(report([mk('canvas_connected', 'canvas', 'warn', { mode: 'fixture' })]));
    wrap(<Summary />);
    await screen.findByTestId('health-headline');
    expect(screen.getByTestId('health-group-canvas').textContent).toContain('Demo data');
    expect(screen.getByTestId('health-group-canvas').textContent).not.toContain('Live');
  });
});

describe('/squad/connections/health', () => {
  it('replaces itself with /squad/connections#health', async () => {
    render(
      <MemoryRouter initialEntries={['/squad/connections/health']}>
        <Routes>
          <Route path="/squad/connections/health" element={<HealthRedirect />} />
          <Route path="/squad/connections" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByTestId('where')).textContent).toBe('/squad/connections#health');
  });
});
