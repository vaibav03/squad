// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createInspectorStore } from '@squad/village/inspector';
import { ASK_FIXTURE, createCouncilBoardStore, playCouncilFixture } from '@squad/village/council';
import { getBoardStore, setBoardStore, useBoardOpen } from '../../council/board/bridge';
import { InspectorPanel } from './InspectorPanel';

afterEach(() => {
  cleanup();
  setBoardStore(null);
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 40)));

function Probe() {
  const o = useBoardOpen();
  return <output data-testid="open">{o.open ? `open:${o.agent ?? ''}` : 'closed'}</output>;
}

describe('Hierarchy tab', () => {
  it('says so when no board store exists', async () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.seed('council:ask-chair');
    render(<InspectorPanel store={store} />);
    act(() => store.select('council:ask-chair'));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Structure' }));
    expect(screen.getByText('Not part of a council run yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
  });

  it('shows position, children, delegations, mode, and opens the board', async () => {
    const board = createCouncilBoardStore();
    playCouncilFixture(ASK_FIXTURE, (e) => board.apply(e), { instant: true });
    setBoardStore(board);
    const store = createInspectorStore({ me: 's_ana' });
    const run = board.run()!;
    for (const a of run.agents) store.seed(a.id);
    const chair = run.agents.find((a) => a.role === 'chair')!;
    const spec = run.agents.find((a) => a.role === 'specialist')!;
    render(
      <>
        <InspectorPanel store={store} />
        <Probe />
      </>,
    );
    act(() => store.select(chair.id));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Structure' }));
    expect(screen.getByText('Chair, top of the tree')).toBeTruthy();
    expect(screen.getByText('Fixture')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Delegations out' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Delegations in' })).toBeTruthy();
    // child chip selects that agent
    const hier = screen.getByTestId('hierarchy');
    const chip = [...hier.querySelectorAll('button.ai-party')].find(
      (b) => b.textContent === spec.name,
    )!;
    expect(chip).toBeTruthy();
    fireEvent.click(chip);
    expect(store.selected).toBe(spec.id);
    await settle();
    if (!screen.queryByTestId('hierarchy'))
      fireEvent.click(screen.getByRole('tab', { name: 'Structure' }));
    expect(screen.getByText(/Specialist under/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open council board' }));
    expect(screen.getByTestId('open').textContent).toBe(`open:${spec.id}`);
    expect(getBoardStore()).toBe(board);
  });

  it('the room-level council agent lists chair and specialists', async () => {
    const board = createCouncilBoardStore();
    playCouncilFixture(ASK_FIXTURE, (e) => board.apply(e), { instant: true });
    setBoardStore(board);
    const store = createInspectorStore({ me: 's_ana' });
    store.seed('council:ask');
    render(<InspectorPanel store={store} />);
    act(() => store.select('council:ask'));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Structure' }));
    expect(screen.getByText('Chair', { selector: 'dt' })).toBeTruthy();
    expect(screen.getByText('Specialists')).toBeTruthy();
  });
});
