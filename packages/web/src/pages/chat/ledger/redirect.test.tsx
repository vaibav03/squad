// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import LedgerRedirect from '../../ledger/index';
import { squadNav, squadRouteMeta } from '../../../shell/routes';
import { useLedgerDrawer } from './useLedgerDrawer';

afterEach(cleanup);

function Where() {
  const l = useLocation();
  const d = useLedgerDrawer();
  return <p data-testid="where" data-open={String(d.isOpen)}>{l.pathname + l.search}</p>;
}

describe('old /squad/ledger links', () => {
  it.each(['/squad/ledger', '/squad/ledger/task_trip_cabo'])('%s redirects into the group chat with view=ledger', (from) => {
    render(
      <MemoryRouter initialEntries={[from]}>
        <Routes>
          <Route path="/squad/ledger/:taskId?" element={<LedgerRedirect />} />
          <Route path="/squad/chat" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const w = screen.getByTestId('where');
    expect(w.textContent).toBe('/squad/chat?view=ledger&notice=ledger-moved');
    expect(w.getAttribute('data-open')).toBe('true');
  });

  it('is not in the primary navigation', () => {
    expect(squadNav.some((n) => n.key === 'ledger')).toBe(false);
    expect(squadRouteMeta.find((m) => m.key === 'ledger')?.nav).toBeUndefined();
  });
});
