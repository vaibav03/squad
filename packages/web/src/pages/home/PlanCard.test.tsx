// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomePlanCard } from './PlanCard';
import { planView } from '../../overlays/plan/fixtures';

vi.mock('../../shell/context', () => ({
  useSquadConfig: () => ({ mode: 'live', hubUrl: 'http://h', token: 't' }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('HomePlanCard', () => {
  it('empty state links to the panel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ plan: null }), { status: 200 })),
    );
    render(<HomePlanCard />);
    await screen.findByText(/No study plan yet/);
    expect(screen.getByTestId('home-plan-open').getAttribute('href')).toBe(
      '/squad/chat?wizard=study',
    );
    expect(screen.getByTestId('home-plan-open').textContent).toBe('Create a study plan');
  });
  it('shows badge, countdown, progress and saved version', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ plan: planView() }), { status: 200 })),
    );
    render(<HomePlanCard />);
    expect((await screen.findByTestId('plan-mode-badge')).textContent).toBe(
      'Demo: sample data, scripted',
    );
    expect(screen.getByTestId('home-plan-countdown').textContent).toContain('6 days to the exam');
    expect(screen.getByTestId('home-plan-saved').textContent).toContain('Saved, version 3');
  });
});
