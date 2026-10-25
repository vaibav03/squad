// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StudyFlow, studyStepFor } from './StudyFlow';
import { planView } from '../overlays/plan/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const hub = { hubUrl: 'http://h', token: 't' };

function stub(routes: Record<string, unknown>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('http://h', '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const hit = Object.keys(routes).find((k) => key.startsWith(k));
    return new Response(JSON.stringify(hit ? routes[hit] : {}), { status: hit ? 200 : 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('studyStepFor', () => {
  it('maps plan state to a step', () => {
    expect(studyStepFor(null)).toBe('goal');
    expect(studyStepFor(planView({ status: 'proposed' }))).toBe('edits');
    expect(studyStepFor(planView({ status: 'active' }))).toBe('plan');
  });
});

describe('StudyFlow', () => {
  it('goal -> availability -> draft on the hub plan service, labelled Demo honestly', async () => {
    const fn = stub({
      'GET /v1/plans/current': { plan: null },
      'POST /v1/plans': { plan: planView() },
    });
    render(<StudyFlow hub={hub} />);
    fireEvent.change(screen.getByTestId('study-date'), { target: { value: '2027-01-15' } });
    await userEvent.type(screen.getByTestId('study-label'), 'Stats midterm');
    await userEvent.click(screen.getByTestId('study-next'));
    expect(screen.getByTestId('study-availability').textContent).toMatch(/Event titles/);
    await userEvent.click(screen.getByTestId('study-draft'));
    await screen.findByTestId('study-draft-view');
    const post = fn.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      examDate: '2027-01-15',
      examLabel: 'Stats midterm',
    });
    expect(screen.getByTestId('study-truth').textContent).toMatch(/^Demo/);
    expect(screen.getByTestId('study-truth').textContent).not.toMatch(/\b(\w+)\s+\1\b/i);
    expect(screen.getByTestId('study-mode').textContent).toMatch(/Demo.*Fallback sample plan|Demo/);
    expect(screen.getByTestId('study-aggregate').textContent).toMatch(/hidden below 3/);
    expect(screen.getByTestId('study-sources').textContent).toMatch(/2 sources/);
  });

  it('an existing proposed plan opens at edits/votes and accepts through the plan service', async () => {
    const accepted = planView({
      me: { id: 's_ben', response: 'accepted', optedIn: true, isOrganizer: false },
    });
    const fn = stub({
      'GET /v1/plans/current': {
        plan: planView({
          me: { id: 's_ben', response: 'pending', optedIn: true, isOrganizer: false },
        }),
      },
      'POST /v1/plans/pl_abcdefghij/respond': { plan: accepted },
    });
    render(<StudyFlow hub={hub} />);
    await screen.findByTestId('study-edits');
    expect(screen.getByTestId('study-item-it1')).toBeTruthy();
    await userEvent.click(screen.getByTestId('study-accept'));
    await waitFor(() => expect(screen.queryByTestId('study-accept')).toBeNull());
    expect(fn.mock.calls.some((c) => String(c[0]).endsWith('/respond'))).toBe(true);
  });

  it('a plan service failure is said in words', async () => {
    stub({ 'GET /v1/plans/current': { plan: null } });
    render(<StudyFlow hub={hub} />);
    fireEvent.change(screen.getByTestId('study-date'), { target: { value: '2027-01-15' } });
    await userEvent.click(screen.getByTestId('study-next'));
    await userEvent.click(screen.getByTestId('study-draft'));
    expect((await screen.findByTestId('study-error')).textContent).toMatch(/did not work|404/);
  });
});
