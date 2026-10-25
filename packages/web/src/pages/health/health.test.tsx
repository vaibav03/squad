// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { HealthReport } from '@squad/core';
import HealthRoute from './index';
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
  generatedAt: T, overall: checks.some((c) => c.status === 'fail') ? 'fail' : 'pass', servedOrigin: 'http://localhost:5290', checks,
});
const mk = (id: string, group: HealthReport['checks'][number]['group'], status: HealthReport['checks'][number]['status'], extra = {}) => ({
  id, group, label: id, status, reason: `reason-${id}`, probedAt: T, ...extra,
});
const mockFetch = (r: HealthReport | number) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    typeof r === 'number' ? new Response('{}', { status: r }) : new Response(JSON.stringify(r)),
  );
const wrap = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe('health page', () => {
  it('renders each link with status, reason, fix, fixture label and missing env', async () => {
    mockFetch(report([
      mk('canvas_connected', 'canvas', 'pass', { mode: 'fixture' }),
      mk('google_connected', 'google', 'blocked', { missingEnv: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'] }),
      mk('redirect_origin', 'google', 'fail', { fix: { label: 'Open Connections', to: '/squad/connections' } }),
      mk('context_retrievable', 'chain', 'warn'),
      mk('sendblue_outbound', 'sendblue', 'blocked', { missingEnv: ['SENDBLUE_API_KEY'] }),
    ]));
    wrap(<HealthRoute />);
    await screen.findByTestId('health-page');
    await screen.findByTestId('health-check-canvas_connected');
    expect(screen.getByTestId('health-status-canvas_connected').textContent).toBe('Pass');
    expect(screen.getByTestId('health-check-canvas_connected').textContent).toContain('Fixture (simulated, not your account)');
    expect(screen.getByTestId('health-status-google_connected').textContent).toBe('BLOCKED');
    expect(screen.getByTestId('health-check-google_connected').textContent).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
    expect(screen.getByTestId('health-status-redirect_origin').textContent).toBe('Fail');
    expect(screen.getByTestId('health-fix-redirect_origin').textContent).toBe('Open Connections');
    expect(screen.getByTestId('health-overall').textContent).toBe('Overall: Fail');
    expect(screen.getByText('http://localhost:5290', { exact: false })).toBeTruthy();
  });
  it('Re-run asks the hub again (real probes, no cache)', async () => {
    const f = mockFetch(report([mk('a', 'chain', 'pass')]));
    wrap(<HealthRoute />);
    await screen.findByTestId('health-check-a');
    const before = f.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /Re-run/ }));
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThan(before));
    expect(f.mock.calls[0]![0]).toBe('http://hub/v1/connections/health');
  });
  it('an unreachable health endpoint is an error, never a pass', async () => {
    mockFetch(500);
    wrap(<HealthRoute />);
    expect(await screen.findByText('Health check did not answer')).toBeTruthy();
    expect(screen.queryByTestId('health-overall')).toBeNull();
  });
  it('demo mode probes nothing', () => {
    state.cfg = { mode: 'demo', hubUrl: '', token: '' } as never;
    const f = mockFetch(500);
    wrap(<HealthRoute />);
    expect(screen.getByText('Demo mode')).toBeTruthy();
    expect(f).not.toHaveBeenCalled();
    state.cfg = { mode: 'live', hubUrl: 'http://hub', token: 't' };
  });
});

describe('health banner', () => {
  it('shows on a fail, hidden when healthy, warn only for core chain groups', async () => {
    mockFetch(report([mk('redirect_origin', 'google', 'fail')]));
    wrap(<HealthBanner />);
    expect((await screen.findByTestId('health-banner')).textContent).toContain('1 integration link failing');
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
    expect((await screen.findByTestId('health-banner')).textContent).toContain('unknown, not healthy');
  });
});
