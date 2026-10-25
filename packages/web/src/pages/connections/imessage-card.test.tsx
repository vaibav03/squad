// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ImessageStatus } from '@squad/core';
import { ImessageCardView, RUNBOOK_URL } from './ImessageCard';

afterEach(cleanup);
const NOW = 1_700_000_000_000;
const live: ImessageStatus = {
  enabled: true,
  mode: 'live',
  transport: 'ok',
  queued: 1,
  failed: 0,
  lastSyncAt: NOW - 60_000,
  squads: [{ squadId: 's', name: 'Bio Crew', bound: 2, lastSyncAt: NOW - 60_000 }],
};

describe('ImessageCardView', () => {
  it('shows connected state, counts and squads', () => {
    render(<ImessageCardView status={live} now={NOW} />);
    expect(screen.getByTestId('connections-imessage-state').textContent).toContain(
      'iMessage: connected to Bio Crew',
    );
    expect(screen.getByText(/Queued: 1, failed: 0/)).toBeTruthy();
    expect(screen.getByText(/Bio Crew: 2 groups bound/)).toBeTruthy();
    expect(screen.queryByTestId('connections-imessage-fixture')).toBeNull();
  });
  it('labels a fixture transport honestly', () => {
    render(<ImessageCardView status={{ ...live, mode: 'fixture', fixture: true }} now={NOW} />);
    expect(screen.getByTestId('connections-imessage-fixture').textContent).toContain('Demo data');
    expect(screen.getByTestId('messaging-phase').textContent).toBe('Demo data');
  });
  it('dry run and off', () => {
    render(<ImessageCardView status={{ ...live, mode: 'dry_run', dryRun: true }} now={NOW} />);
    expect(screen.getByTestId('connections-imessage-state').textContent).toContain(
      'iMessage: dry run',
    );
    cleanup();
    render(<ImessageCardView status={{ enabled: false }} now={NOW} />);
    expect(screen.getByTestId('connections-imessage-state').textContent).toContain(
      'off (kill switch on)',
    );
  });
  it('lists the five safe-setup steps and the runbook link', () => {
    render(<ImessageCardView status={{ enabled: false }} now={NOW} />);
    const steps = screen.getByTestId('connections-imessage-steps');
    expect(steps.querySelectorAll('li')).toHaveLength(5);
    expect(steps.textContent).toContain('IMESSAGE_ALLOWED_CHATS');
    expect(steps.textContent).toContain('IMESSAGE_DRY_RUN=1');
    expect(steps.textContent).toContain('Kill switch');
    const a = screen.getByRole('link', { name: 'Open the runbook' });
    expect(a.getAttribute('href')).toBe(RUNBOOK_URL);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('docs/imessage.md')).toBeTruthy();
  });
  it('error state has Try again', () => {
    const retry = vi.fn();
    render(<ImessageCardView status={null} error now={NOW} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});
