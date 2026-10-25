// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LedgerView } from './LedgerView';
import { ledgerFromSnapshot } from './model';
import { roster, snapshot, TASK_ID } from './fixtures';

afterEach(cleanup);
const rows = ledgerFromSnapshot(TASK_ID, snapshot).rows;
const props = {
  status: 'ready' as const,
  connection: 'live' as const,
  title: 'T',
  rows,
  roster,
  me: 's_ana',
  projector: false,
  onProjectorChange: () => {},
};

describe('LedgerView', () => {
  it('renders withheld as labelled static bars and no withheld text', () => {
    render(<LedgerView {...props} />);
    expect(screen.getAllByRole('img', { name: 'Withheld' }).length).toBe(3);
    expect(screen.getByText('You kept this private')).toBeTruthy();
    expect(screen.getByText('Blocked by privacy gate')).toBeTruthy();
  });
  it('hides counts for squads under 3', () => {
    render(<LedgerView {...props} roster={roster.slice(0, 2)} />);
    expect(screen.queryByLabelText('Summary')).toBeNull();
  });
  it('projector blurs others until selected, never own rows', () => {
    render(<LedgerView {...props} projector />);
    const hidden = screen.getAllByRole('button', { name: /Hidden while projecting/ });
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((b) => !b.textContent?.includes('You'))).toBe(true);
    fireEvent.click(hidden[0]!);
    expect(screen.getAllByRole('button', { name: /Hidden while projecting/ }).length).toBe(
      hidden.length - 1,
    );
  });
  it('has empty, error and offline states with text', () => {
    const { rerender } = render(<LedgerView {...props} rows={[]} />);
    expect(screen.getByText('Nothing shared yet')).toBeTruthy();
    rerender(<LedgerView {...props} status="error" rows={[]} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<LedgerView {...props} status="offline" rows={[]} />);
    expect(screen.getByText('You are offline')).toBeTruthy();
  });
});
