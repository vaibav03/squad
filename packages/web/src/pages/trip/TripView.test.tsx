// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TripView, noActions, type TripActions, type TripViewProps } from './TripView';
import {
  tripCancelled,
  tripConfirmed,
  tripConfirming,
  tripExpired,
  tripFailed,
  tripPlanning,
  tripVoting,
  tripVotingCounts,
  tripWaiting,
} from './fixtures';

afterEach(cleanup);

const base: TripViewProps = {
  status: 'ready',
  connection: 'live',
  trip: tripPlanning,
  me: 's_ana',
};
function view(p: Partial<TripViewProps> = {}, a: Partial<TripActions> = {}) {
  return render(<TripView {...base} {...p} actions={{ ...noActions, ...a }} />);
}
const id = (s: string) => screen.getByTestId(s);
const q = (s: string) => screen.queryByTestId(s);

describe('TripView states', () => {
  it('empty: friendly copy, plan form posts a body, never the hub-did-not-answer copy', () => {
    const create = vi.fn();
    view({ trip: null }, { create });
    expect(screen.getByRole('heading', { name: 'No trip planned yet' })).toBeTruthy();
    expect(screen.getByText(/Plan one with your squad/)).toBeTruthy();
    expect(screen.getByText(/@squad plan a trip to Cabo in March/)).toBeTruthy();
    expect(screen.queryByText(/hub did not answer/)).toBeNull();
    fireEvent.click(id('trip-create-open'));
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'Cabo' } });
    fireEvent.change(screen.getByLabelText('Month (optional)'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Days (optional)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Cost per person/), { target: { value: '650' } });
    fireEvent.submit(id('trip-create-form'));
    expect(create).toHaveBeenCalledWith({ destination: 'Cabo', month: 3, days: 5, perPerson: 650 });
  });

  it('an ended or confirmed trip offers Plan another trip; an active one does not', () => {
    const create = vi.fn();
    view({ trip: tripCancelled }, { create });
    fireEvent.click(within(id('trip-another')).getByTestId('trip-create-open'));
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'Austin' } });
    fireEvent.submit(id('trip-create-form'));
    expect(create).toHaveBeenCalledWith({ destination: 'Austin' });
    cleanup();
    view({ trip: tripConfirmed });
    expect(q('trip-another')).not.toBeNull();
    cleanup();
    view({ trip: tripVoting });
    expect(q('trip-another')).toBeNull();
  });

  it('planning: options, propose form, constraints overlap, private limits', () => {
    const propose = vi.fn();
    view({}, { propose });
    expect(id('trip-state-planning')).toBeTruthy();
    expect(id('trip-option-cabo').textContent).toContain('Cabo San Lucas');
    expect(id('trip-option-vegas').textContent).toContain('Dropped');
    expect(id('trip-overlap').textContent).toContain('Free days for everyone');
    expect(
      Array.from(id('trip-overlap-days').querySelectorAll('li')).map((l) => l.textContent),
    ).toEqual(['Mar 14', 'Mar 15', 'Mar 16', 'Mar 17']);
    expect(id('trip-limits').textContent).toContain('Only you can see this');
    fireEvent.change(within(id('trip-propose-form')).getByLabelText('Where'), {
      target: { value: 'Tahoe' },
    });
    fireEvent.submit(id('trip-propose-form'));
    expect(propose).toHaveBeenCalledWith({ label: 'Tahoe' });
    expect(id('trip-activity').textContent).toContain('Dev changed Cabo to 5 days');
  });

  it('shows "No days overlap yet" for an empty overlap and nothing for null', () => {
    const t = { ...tripPlanning, constraints: { ...tripPlanning.constraints, overlapDays: [] } };
    const { unmount } = view({ trip: t });
    expect(id('trip-overlap').textContent).toContain('No days overlap yet');
    unmount();
    view({ trip: { ...t, constraints: { ...t.constraints, overlapDays: null } } });
    expect(q('trip-overlap')).toBeNull();
  });

  it('planning with an offline agent: exact waiting copy, retry and continue-without', () => {
    const act = vi.fn();
    view({ trip: tripWaiting }, { act });
    expect(id('trip-waiting-s_dev').textContent).toBe("Dev's agent is offline, trip waits for Dev");
    expect(id('trip-waiting').textContent).toContain(
      "Open Squad on Dev's device to bring their agent back, or the organizer can continue without their agent.",
    );
    expect(id('trip-continue-warning').textContent).toMatch(
      /Calendars and budgets will not be checked/,
    );
    fireEvent.click(id('trip-retry'));
    fireEvent.click(id('trip-continue'));
    expect(act.mock.calls).toEqual([['retry'], ['continue']]);
  });

  it('waiting on a member with no agent, and hides buttons the viewer cannot use', () => {
    const t = {
      ...tripWaiting,
      members: tripWaiting.members.map((m) =>
        m.id === 's_dev' ? { ...m, agent: 'no_agent' as const } : m,
      ),
      can: { ...tripWaiting.can, retry: false, continueWithout: false },
    };
    view({ trip: t });
    expect(id('trip-waiting-s_dev').textContent).toBe('Dev has no agent connected yet');
    expect(q('trip-retry')).toBeNull();
    expect(q('trip-continue')).toBeNull();
  });

  it('member chips: organizer badge, agent state, confirmed', () => {
    view({ trip: tripConfirming });
    expect(id('trip-member-s_ana').textContent).toContain('Organizer');
    expect(id('trip-member-s_ben').textContent).toContain('Agent online');
    expect(id('trip-member-s_ben').textContent).toContain('Confirmed');
    expect(id('trip-member-s_ana').textContent).not.toContain('Confirmed');
  });

  it('member chips show Voted only when voted is true, never a vote for null', () => {
    const members = tripVoting.members.map((m) =>
      m.id === 's_ben' ? { ...m, voted: true } : m.id === 's_chi' ? { ...m, voted: false } : m,
    );
    view({ trip: { ...tripVoting, members } });
    expect(id('trip-member-s_ben').textContent).toContain('Voted');
    expect(id('trip-member-s_chi').textContent).not.toContain('Voted');
    expect(id('trip-member-s_ana').textContent).not.toContain('Voted');
  });

  it('empty with a not-found trip id names it, still no hub-did-not-answer copy', () => {
    view({ trip: null, notFound: true });
    expect(screen.getByRole('heading', { name: 'We could not find that trip' })).toBeTruthy();
    expect(screen.queryByText(/hub did not answer/)).toBeNull();
  });

  it('shows the cutscene link only when confirmed', () => {
    view({ trip: tripConfirming });
    expect(q('trip-cutscene-link')).toBeNull();
  });

  it('voting: secret note, no counts when voteProgress is null, submit sends ranking and opened rev', () => {
    const vote = vi.fn();
    view({ trip: tripVoting }, { vote });
    expect(id('trip-vote-note').textContent).toBe(
      'Votes are secret. Counts appear once 3 members have voted.',
    );
    expect(q('trip-vote-progress')).toBeNull();
    fireEvent.click(screen.getByLabelText('Move Austin weekend up'));
    fireEvent.click(id('trip-submit-vote'));
    expect(vote).toHaveBeenCalledWith(['austin', 'cabo'], tripVoting.rev);
    expect(id('trip-close-voting')).toBeTruthy();
  });

  it('voting with counts shown, no close button without can.closeVoting', () => {
    view({
      trip: { ...tripVotingCounts, can: { ...tripVotingCounts.can, closeVoting: false } },
    });
    expect(id('trip-vote-progress').textContent).toBe('3 of 4 have voted');
    expect(q('trip-close-voting')).toBeNull();
  });

  it('confirming: chosen option, confirm and not for me', () => {
    const confirm = vi.fn();
    view({ trip: tripConfirming }, { confirm });
    expect(id('trip-chosen').textContent).toContain('Austin weekend, Mar 15 to 17');
    fireEvent.click(id('trip-confirm-yes'));
    fireEvent.click(id('trip-confirm-no'));
    expect(confirm.mock.calls).toEqual([
      ['austin', true, tripConfirming.rev],
      ['austin', false, tripConfirming.rev],
    ]);
  });

  it('confirming: no buttons when the viewer cannot confirm', () => {
    view({ trip: { ...tripConfirming, can: { ...tripConfirming.can, confirm: false } } });
    expect(q('trip-confirm-yes')).toBeNull();
  });

  it('confirmed: celebration with the cutscene link on the task id', () => {
    const seen = vi.fn();
    view({ trip: tripConfirmed, onWatchCutscene: seen });
    expect(id('trip-celebration')).toBeTruthy();
    const a = id('trip-cutscene-link') as HTMLAnchorElement;
    expect(a.textContent).toContain('Watch the trip cutscene');
    expect(a.getAttribute('href')).toBe('/squad/village?cutscene=trip&task=task_trip_cabo');
    fireEvent.click(a);
    expect(seen).toHaveBeenCalled();
  });

  it.each([
    ['failed', tripFailed, 'No days work for everyone in that window.'],
    ['expired', tripExpired, 'Nobody confirmed before the deadline.'],
    ['cancelled', tripCancelled, 'Ana cancelled the trip.'],
  ])('%s: plain reason and reopen', (status, trip, msg) => {
    const act = vi.fn();
    view({ trip }, { act });
    expect(id(`trip-state-${status}`)).toBeTruthy();
    expect(id('trip-failure').textContent).toBe(msg);
    fireEvent.click(id('trip-reopen'));
    expect(act).toHaveBeenCalledWith('reopen');
  });

  it('no reopen button without can.reopen', () => {
    view({ trip: { ...tripFailed, can: { ...tripFailed.can, reopen: false } } });
    expect(q('trip-reopen')).toBeNull();
  });

  it.each([
    ['live', 'live: a real model wrote this wording'],
    ['degraded', 'degraded: the model fell back partway, so the wording may be simpler'],
    ['demo', 'demo: scripted rules, no model'],
  ] as const)('recommendation badge %s', (mode, title) => {
    view({ trip: { ...tripPlanning, recommendation: { ...tripPlanning.recommendation!, mode } } });
    const b = id('trip-rec-mode');
    expect(b.textContent).toBe(mode);
    expect(b.getAttribute('title')).toBe(title);
    expect(id('trip-rec-dissent').textContent).toContain('Skeptic says');
    expect(id('trip-rec-chair')).toBeTruthy();
    expect(id('trip-rec-planner')).toBeTruthy();
  });

  it('conflict banner names the other member and offers both resolutions', () => {
    const keepTheirs = vi.fn();
    const replaceWithMine = vi.fn();
    view(
      {
        conflict: {
          message: 'changed',
          conflict: {
            rev: 9,
            option: null,
            change: {
              rev: 9,
              by: 's_dev',
              byName: 'Dev',
              at: 1,
              summary: 'changed Cabo to 6 days',
            },
          },
          resend: async () => {},
        },
      },
      { keepTheirs, replaceWithMine },
    );
    const b = id('trip-conflict');
    expect(b.getAttribute('role')).toBe('alert');
    expect(id('trip-conflict-detail').textContent).toBe('Dev: changed Cabo to 6 days');
    fireEvent.click(id('trip-keep-theirs'));
    fireEvent.click(id('trip-replace-mine'));
    expect(keepTheirs).toHaveBeenCalled();
    expect(replaceWithMine).toHaveBeenCalled();
  });

  it('edit sends the rev from when the edit was opened', () => {
    const editOption = vi.fn();
    view({}, { editOption });
    fireEvent.click(screen.getByLabelText('Edit Cabo San Lucas'));
    fireEvent.change(screen.getByLabelText('Days'), { target: { value: '6' } });
    fireEvent.submit(id('trip-edit-form'));
    expect(editOption).toHaveBeenCalledWith('cabo', { days: 6 }, tripPlanning.rev);
  });

  it('network error: honest copy with Retry; offline too', () => {
    const onRetry = vi.fn();
    const { unmount } = view({ status: 'error', trip: undefined, onRetry });
    expect(screen.getByText(/The hub did not answer/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    unmount();
    view({ status: 'offline', trip: undefined, onRetry });
    expect(id('trip-offline')).toBeTruthy();
  });
});
