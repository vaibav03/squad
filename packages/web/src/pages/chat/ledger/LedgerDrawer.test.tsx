// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LedgerDrawer } from './LedgerDrawer';
import { fixtureLedger } from './fixtures';
import { CHAT_PREFILL_EVENT } from '../prefill';

afterEach(cleanup);
const NOW = Date.UTC(2026, 9, 20, 20, 0);

describe('LedgerDrawer', () => {
  it('shows a loading state, then entries newest first with who, when, kind and provenance', async () => {
    render(
      <LedgerDrawer groupId="group:sq" onClose={() => {}} now={NOW} fetchLedger={() => Promise.resolve(fixtureLedger)} />,
    );
    expect(screen.getByRole('status', { name: 'Loading ledger' })).toBeTruthy();
    const rows = await screen.findAllByTestId('ledger-entry');
    expect(rows.length).toBe(fixtureLedger.length);
    expect(rows[0]!.textContent).toContain('Ana confirmed');
    expect(rows[0]!.textContent).toContain('Decision');
    expect(rows[0]!.textContent).toContain('By Ana');
    expect(rows[0]!.textContent).toMatch(/hours? ago|min ago/);
    expect(rows.at(-1)!.getAttribute('data-kind')).toBe('plan_created');
  });

  it('labels fixture data Demo, never Live', async () => {
    render(<LedgerDrawer groupId="g" onClose={() => {}} fetchLedger={() => Promise.resolve(fixtureLedger)} />);
    const modes = await screen.findAllByTestId('ledger-mode');
    expect(modes.every((m) => m.textContent === 'Demo')).toBe(true);
  });

  it('empty state explains the ledger and offers to plan in chat', async () => {
    const onClose = vi.fn();
    const seen = vi.fn();
    window.addEventListener(CHAT_PREFILL_EVENT, seen);
    render(<LedgerDrawer groupId="g" onClose={onClose} fetchLedger={() => Promise.resolve([])} />);
    expect(await screen.findByText('Nothing in the ledger yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plan something in chat' }));
    expect(onClose).toHaveBeenCalled();
    expect(seen).toHaveBeenCalled();
    window.removeEventListener(CHAT_PREFILL_EVENT, seen);
  });

  it('error state has Retry that reloads; 404 says the group is not yours', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(fixtureLedger);
    const { unmount } = render(<LedgerDrawer groupId="g" onClose={() => {}} fetchLedger={f} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getAllByTestId('ledger-entry').length).toBeGreaterThan(0));
    unmount();
    render(<LedgerDrawer groupId="g" onClose={() => {}} fetchLedger={() => Promise.reject(new Error('not_found'))} />);
    expect(await screen.findByText('Ledger not found')).toBeTruthy();
  });

  it('is a dialog: focus moves in, Tab wraps, Esc closes', async () => {
    const onClose = vi.fn();
    render(<LedgerDrawer groupId="g" onClose={onClose} fetchLedger={() => Promise.resolve([])} />);
    const dlg = screen.getByRole('dialog', { name: 'Group ledger' });
    const close = screen.getByRole('button', { name: 'Close ledger' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await screen.findByText('Nothing in the ledger yet');
    const cta = screen.getByRole('button', { name: 'Plan something in chat' });
    cta.focus();
    fireEvent.keyDown(cta, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cta);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the migration notice when given one', async () => {
    render(
      <LedgerDrawer groupId="g" onClose={() => {}} notice="The ledger now lives inside each group chat." fetchLedger={() => Promise.resolve([])} />,
    );
    expect(screen.getByTestId('ledger-notice').textContent).toBe('The ledger now lives inside each group chat.');
    await screen.findByText('Nothing in the ledger yet');
  });
});
