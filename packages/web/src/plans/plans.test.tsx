// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { PlusMenu } from './PlusMenu';
import { PlansDrawer } from './PlansDrawer';
import { WizardDrawer } from './WizardDrawer';
import { filterPlans, parsePlans } from './model';
import { FLOWS } from './registry';

afterEach(cleanup);

const plans = parsePlans(
  {
    trips: [
      { tripId: 't1', title: 'Cabo in March', status: 'planning' },
      { tripId: 't2', title: 'Austin', status: 'confirmed' },
    ],
  },
  { plan: { planId: 'pl_abcdefghij', title: 'Midterm prep', status: 'draft' } },
);

describe('plans model', () => {
  it('parses trips and the study plan, filters by kind and activity', () => {
    expect(plans.map((p) => p.id)).toEqual(['t1', 't2', 'pl_abcdefghij']);
    expect(filterPlans(plans, 'trips')).toHaveLength(2);
    expect(filterPlans(plans, 'study')).toHaveLength(1);
    expect(filterPlans(plans, 'active').map((p) => p.id)).toEqual(['t1', 'pl_abcdefghij']);
    expect(filterPlans(plans, 'completed').map((p) => p.id)).toEqual(['t2']);
    expect(parsePlans(null, null)).toEqual([]);
  });
  it('registry flows list the expected steps', () => {
    expect(FLOWS.trip.steps.map((s) => s.label)).toEqual([
      'Brief',
      'Availability',
      'Options',
      'Vote',
      'Itinerary',
    ]);
    expect(FLOWS.study.steps.length).toBe(5);
  });
});

describe('PlusMenu', () => {
  it('opens a menu with both actions, keyboard navigable, Esc refocuses the button', async () => {
    const onPick = vi.fn();
    render(<PlusMenu onPick={onPick} />);
    const btn = screen.getByRole('button', { name: 'Plan together' });
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    fireEvent.keyDown(btn, { key: 'ArrowDown' });
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Plan a trip', 'Create a study plan']);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    await userEvent.click(btn);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Create a study plan' }));
    expect(onPick).toHaveBeenCalledWith('study');
  });
});

describe('WizardDrawer', () => {
  it('trip shell shows the steps and the brief form', () => {
    render(<WizardDrawer kind="trip" groupTitle="Squad" hub={null} onClose={() => {}} />);
    expect(screen.getByTestId('wizard-trip')).toBeTruthy();
    expect(screen.getByTestId('trip-brief-form')).toBeTruthy();
    expect(screen.getByText('Availability')).toBeTruthy();
  });
  it('study wizard starts at the goal step with the five-step stepper', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ plan: null }), { status: 200 })),
    );
    render(<WizardDrawer kind="study" groupTitle="Squad" hub={null} onClose={() => {}} />);
    expect(screen.getByTestId('study-goal-form')).toBeTruthy();
    expect(screen.getByText('Shared plan')).toBeTruthy();
    expect(screen.queryByTestId('trip-brief-form')).toBeNull();
    vi.unstubAllGlobals();
  });
  it('creates the trip through the existing API and links the full plan', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ trip: { tripId: 'trip_x1' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <WizardDrawer
        kind="trip"
        groupTitle="Squad"
        hub={{ hubUrl: 'http://h', token: 't' }}
        onClose={() => {}}
      />,
    );
    await userEvent.type(screen.getByTestId('brief-destination'), 'Cabo');
    await userEvent.selectOptions(screen.getByTestId('brief-month'), '3');
    await userEvent.type(screen.getByTestId('brief-days'), '4');
    await userEvent.type(screen.getByTestId('brief-budget'), '1200');
    await userEvent.click(screen.getByTestId('brief-submit'));
    await screen.findByTestId('wizard-created');
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('http://h/v1/trips');
    expect(JSON.parse(call[1].body as string)).toEqual({
      destination: 'Cabo',
      month: 3,
      days: 4,
      perPerson: 1200,
    });
    vi.unstubAllGlobals();
  });
});

describe('PlusMenu ledger entry', () => {
  it('offers Group activity & ledger when the chat can open it', async () => {
    const onLedger = vi.fn();
    render(<PlusMenu onPick={() => {}} onLedger={onLedger} />);
    await userEvent.click(screen.getByTestId('composer-plus'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Plan a trip',
      'Create a study plan',
      'Group activity & ledger',
    ]);
    await userEvent.click(items[2]!);
    expect(onLedger).toHaveBeenCalled();
  });
});

describe('PlansDrawer', () => {
  const base = {
    loading: false,
    error: false,
    onRetry: () => {},
    onCreate: vi.fn(),
    onClose: () => {},
  };
  it('lists plans with type, status and filters', async () => {
    render(<PlansDrawer {...base} plans={plans} />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    await userEvent.click(screen.getByTestId('plans-filter-completed'));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Agreed')).toBeTruthy();
  });
  it('empty state offers both create actions', async () => {
    const onCreate = vi.fn();
    render(<PlansDrawer {...base} onCreate={onCreate} plans={[]} />);
    await userEvent.click(screen.getByRole('button', { name: /Plan a trip/ }));
    await userEvent.click(screen.getByRole('button', { name: /Create a study plan/ }));
    expect(onCreate.mock.calls.map((c) => c[0])).toEqual(['trip', 'study']);
  });
});
