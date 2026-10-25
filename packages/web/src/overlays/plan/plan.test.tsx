// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PlanPanel, type PlanPanelProps } from './PlanPanel';
import { PlanLayer } from './PlanLayer';
import { conflictedPlan, planView } from './fixtures';
import { groupByDate } from './model';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = (over: Partial<PlanPanelProps> = {}): PlanPanelProps => ({
  open: true,
  onClose: () => {},
  plan: planView(),
  status: 'ready',
  onRespond: vi.fn(),
  onConfirm: vi.fn(),
  onEdit: vi.fn(),
  onResolve: vi.fn(),
  onDone: vi.fn(),
  ...over,
});

describe('PlanPanel', () => {
  it('shows countdown, progress words, load, timeline by day and citations', () => {
    render(<PlanPanel {...props()} />);
    expect(screen.getByRole('dialog', { name: 'Study plan' })).toBeTruthy();
    expect(screen.getByTestId('plan-countdown').textContent).toBe('6 days to the exam');
    expect(screen.getByTestId('plan-progress').textContent).toBe('1 of 3 items done');
    expect(screen.getAllByTestId('plan-day')).toHaveLength(2);
    expect(screen.getAllByTestId('plan-item')).toHaveLength(3);
    expect(within(screen.getByTestId('plan-load')).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('plan-citations').textContent).toContain('ch6.pdf p.4');
    expect(screen.getByTestId('plan-busy')).toBeTruthy();
    expect(groupByDate(planView().items).map((g) => g.date)).toEqual(['2026-11-03', '2026-11-05']);
  });

  it('accept, decline and organizer confirm', () => {
    const p = props({ plan: planView({ me: { ...planView().me, response: 'pending' } }) });
    render(<PlanPanel {...p} />);
    fireEvent.click(screen.getByTestId('plan-accept'));
    fireEvent.click(screen.getByTestId('plan-decline'));
    fireEvent.click(screen.getByTestId('plan-confirm'));
    expect(p.onRespond).toHaveBeenNthCalledWith(1, 'accept');
    expect(p.onRespond).toHaveBeenNthCalledWith(2, 'decline');
    expect(p.onConfirm).toHaveBeenCalled();
  });

  it('marks own items done and edits with the item rev', () => {
    const p = props();
    render(<PlanPanel {...p} />);
    fireEvent.click(screen.getByTestId('plan-done-it1'));
    expect(p.onDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'it1' }), true);
    expect(screen.queryByTestId('plan-done-it2')).toBeNull(); // Ben's item
    fireEvent.click(screen.getByTestId('plan-edit-it1'));
    fireEvent.change(screen.getByTestId('plan-edit-date'), { target: { value: '2026-11-04' } });
    fireEvent.click(screen.getByTestId('plan-save'));
    expect(p.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'it1', rev: 1 }), {
      date: '2026-11-04',
    });
  });

  it('conflict banner shows both versions and picks one', () => {
    const p = props({ plan: conflictedPlan() });
    render(<PlanPanel {...p} />);
    const banner = screen.getByTestId('plan-conflict');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('plan-theirs').textContent).toContain('Ben');
    expect(screen.getByTestId('plan-mine').textContent).toContain('1 h 30 min');
    fireEvent.click(screen.getByTestId('plan-pick-theirs'));
    fireEvent.click(screen.getByTestId('plan-pick-mine'));
    expect(p.onResolve).toHaveBeenNthCalledWith(1, 'cf1', 'theirs');
    expect(p.onResolve).toHaveBeenNthCalledWith(2, 'cf1', 'mine');
  });

  it('badges are honest and nothing reads as a score', () => {
    const { rerender, container } = render(<PlanPanel {...props()} />);
    expect(screen.getByTestId('plan-mode').textContent).toBe('Demo');
    rerender(
      <PlanPanel
        {...props({
          plan: planView({ generator: { mode: 'degraded', source: 'fallback', note: '' } }),
        })}
      />,
    );
    expect(screen.getByTestId('plan-mode').textContent).toBe('Degraded');
    expect(container.textContent).not.toMatch(/\b(points?|streak|rank|leaderboard|score|xp)\b/i);
  });

  it('empty state offers to ask Cubbie; error state offers retry', () => {
    const onAsk = vi.fn();
    const { rerender } = render(<PlanPanel {...props({ plan: null, onAsk })} />);
    fireEvent.click(screen.getByTestId('plan-ask'));
    expect(onAsk).toHaveBeenCalledWith('@cubbie study plan');
    const onRetry = vi.fn();
    rerender(<PlanPanel {...props({ plan: undefined, status: 'error', onRetry })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('PlanLayer', () => {
  it('loads on open and posts the pick with the plan id', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        return new Response(JSON.stringify({ plan: conflictedPlan() }), { status: 200 });
      }),
    );
    render(<PlanLayer hub={{ hubUrl: 'http://h', token: 't' }} initialOpen pollMs={60_000} />);
    const pick = await screen.findByTestId('plan-pick-mine');
    fireEvent.click(pick);
    await screen.findByTestId('plan-notice');
    expect(calls[0]).toBe('GET http://h/v1/plans/current');
    expect(
      calls.some((c) => c === 'POST http://h/v1/plans/pl_abcdefghij/conflicts/cf1/resolve'),
    ).toBe(true);
  });
});
