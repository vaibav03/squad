// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNCIL_KEY_FIX, type CouncilStatus } from '@squad/core';
import { createCouncilBoardStore } from '@squad/village/council';
import { createInspectorStore } from '@squad/village/inspector';
import { InspectorPanel } from '../../overlays/inspector/InspectorPanel';
import { setBoardStore } from '../board/bridge';
import { CouncilBoard } from '../board/CouncilBoard';
import { storedRunFixture } from '../fixtures';
import { COUNCIL_STARTED_EVENT } from '../started-event';
import { EmptyCouncilState, LastRunLabel, LastRunSync, CouncilRoomStatus } from './components';
import { agentNoteFrom } from './agent-note';
import { setCouncilHub } from './hub';
import {
  agoWords,
  historic,
  lastRunLabel,
  recordToEvents,
  resetLastRuns,
  setLastRuns,
} from './store';
import { hydrateFromHistory } from './useCouncilRuns';

const HUB = { hubUrl: 'http://hub.test', token: 'tok' };
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

function statusBody(o: Partial<CouncilStatus> = {}): CouncilStatus {
  return {
    provider: 'Google Gemini',
    generatedAt: 1,
    key: { state: 'ok', fix: COUNCIL_KEY_FIX.ok },
    defaultTransport: 'stream',
    models: { fast: 'f', main: 'm', chair: 'c', live: 'gemini-3.8-live' },
    transports: {
      stream: { available: true, label: 'Gemini streaming text' },
      live: { enabled: true, state: 'untested', label: 'Gemini Live (not tried yet)' },
    },
    demo: { forced: false },
    a2a: { runs: 0, messages: 0, delegations: 0, activeRuns: 0 },
    ...o,
  };
}

/** A fake hub: status, runs, ask. Returns the calls. */
function fakeHub(o: { status?: CouncilStatus; runs?: unknown[] } = {}) {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    const j = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st });
    if (u.endsWith('/v1/council/status')) return j(o.status ?? statusBody());
    if (u.endsWith('/v1/council/runs')) return j({ runs: o.runs ?? [] });
    if (u.endsWith('/v1/council/ask'))
      return j(
        {
          id: 'cn_newrun000001',
          status: 'running',
          streamUrl: '/v1/council/cn_newrun000001/stream',
          resultUrl: '/v1/council/cn_newrun000001',
        },
        202,
      );
    return j({}, 404);
  });
  return calls;
}

beforeEach(() => resetLastRuns());
afterEach(() => {
  cleanup();
  setBoardStore(null);
  setCouncilHub(null);
  resetLastRuns();
  vi.unstubAllGlobals();
});

describe('labels', () => {
  it('relative time and mode words', () => {
    const now = 1_000_000_000;
    expect(agoWords(now - 10_000, now)).toBe('just now');
    expect(agoWords(now - 4 * 60_000, now)).toBe('4 min ago');
    expect(agoWords(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(agoWords(now - 2 * 86_400_000, now)).toBe('2 days ago');
    expect(lastRunLabel({ startedAt: now - 4 * 60_000, mode: 'live' }, now)).toBe(
      'Last council, 4 min ago, Live',
    );
    expect(lastRunLabel({ startedAt: now - 4 * 60_000, mode: 'demo' }, now)).toBe(
      'Last council, 4 min ago, Demo',
    );
    expect(lastRunLabel({ startedAt: now - 4 * 60_000, mode: 'degraded:rate_limited' }, now)).toBe(
      'Last council, 4 min ago, Degraded: rate limited',
    );
    expect(lastRunLabel({ startedAt: now - 60_000, mode: 'live' }, now, 'Round Table')).toBe(
      'Last Round Table, 1 min ago, Live',
    );
  });
});

describe('stored run mapping', () => {
  it('rebuilds the hierarchy, thread, status and actions on the board', () => {
    const board = createCouncilBoardStore();
    const rec = storedRunFixture();
    hydrateFromHistory([rec], board, null);
    const run = board.run()!;
    expect(run.runId).toBe(rec.id);
    expect(run.question).toBe(rec.question);
    expect(run.agents.map((a) => a.name).sort()).toEqual(['Chair', 'Skeptic', 'Teacher']);
    expect(run.delegations.length).toBe(2);
    expect(run.verdict?.actionItems.length).toBe(2);
    expect(run.stage).toBe('done');
    expect(historic.has(rec.id)).toBe(true);
  });
  it('a live run on the board wins: history is not folded in', () => {
    const board = createCouncilBoardStore();
    for (const e of recordToEvents(storedRunFixture({ id: 'cn_live00000001' }))) board.apply(e);
    hydrateFromHistory([storedRunFixture()], board, null);
    expect(board.runs().map((r) => r.runId)).toEqual(['cn_live00000001']);
  });
  it('a running stored run is never labelled "last"', () => {
    setLastRuns([storedRunFixture({ status: 'running' })]);
    const board = createCouncilBoardStore();
    hydrateFromHistory([storedRunFixture({ status: 'running' })], board, null);
    render(<LastRunLabel runId={storedRunFixture().id} />);
    expect(screen.queryByTestId('last-run-label')).toBeNull();
  });
});

describe('empty state', () => {
  it('Convene starts a real run through the start helper, then announces and opens the board', async () => {
    const calls = fakeHub();
    const started: unknown[] = [];
    window.addEventListener(COUNCIL_STARTED_EVENT, (e) => started.push((e as CustomEvent).detail));
    render(<EmptyCouncilState hub={HUB} />);
    await settle();
    expect(screen.getByText('No council has met yet')).toBeTruthy();
    fireEvent.click(screen.getByTestId('convene'));
    await settle();
    const ask = calls.find((c) => c.url.endsWith('/v1/council/ask'))!;
    expect(ask.body).toEqual({
      question: 'What is the most important idea in this chapter?',
      transport: 'stream',
    });
    expect(started).toContainEqual({
      id: 'cn_newrun000001',
      councilKey: 'ask',
      transport: 'stream',
    });
  });
  it('the question is editable and the Live toggle defaults on only when the hub default is live', async () => {
    const calls = fakeHub({
      status: statusBody({
        defaultTransport: 'live',
        transports: {
          stream: { available: true, label: 'x' },
          live: { enabled: true, state: 'ok', label: 'Gemini Live (audio + transcript)' },
        },
      }),
    });
    render(<EmptyCouncilState hub={HUB} />);
    await settle();
    const toggle = screen.getByLabelText('Use Gemini Live') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Is B right?' } });
    fireEvent.click(screen.getByTestId('convene'));
    await settle();
    expect(calls.find((c) => c.url.endsWith('/ask'))!.body).toEqual({
      question: 'Is B right?',
      transport: 'live',
    });
  });
  it('Live that failed last time cannot be switched on and says why', async () => {
    const calls = fakeHub({
      status: statusBody({
        transports: {
          stream: { available: true, label: 'x' },
          live: {
            enabled: true,
            state: 'unavailable',
            why: 'credits_depleted',
            label: 'Gemini Live unavailable: credits depleted',
          },
        },
      }),
    });
    render(<EmptyCouncilState hub={HUB} />);
    await settle();
    const toggle = screen.getByLabelText(/Use Gemini Live/) as HTMLInputElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText(/Gemini Live unavailable: credits depleted/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('convene'));
    await settle();
    expect(
      (calls.find((c) => c.url.endsWith('/ask'))!.body as { transport: string }).transport,
    ).toBe('stream');
  });
  it('with no hub it plays a labelled sample into the board store', async () => {
    const store = createCouncilBoardStore();
    render(<EmptyCouncilState store={store} />);
    expect(screen.getByTestId('empty-nohub').textContent).toContain('DEMO');
    fireEvent.click(screen.getByTestId('convene'));
    await settle();
    expect(store.runs().length).toBe(1);
  });
  it('a failed start says so in fixed copy', async () => {
    vi.stubGlobal('fetch', async (u: string) =>
      String(u).endsWith('/ask')
        ? new Response('{}', { status: 429 })
        : new Response(JSON.stringify(statusBody()), { status: 200 }),
    );
    render(<EmptyCouncilState hub={HUB} />);
    await settle();
    fireEvent.click(screen.getByTestId('convene'));
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/asked a lot|already deliberating/);
  });
});

describe('board and rooms with a stored run', () => {
  it('board with no run shows the empty state (no "Demo / No council session yet"); with history it shows the last run, labelled', async () => {
    const calls = fakeHub({ runs: [storedRunFixture()] });
    const store = createCouncilBoardStore();
    setBoardStore(store);
    render(
      <>
        <LastRunSync hub={HUB} />
        <CouncilBoard store={store} open onClose={() => undefined} hub={HUB} />
      </>,
    );
    await settle();
    await settle();
    expect(calls.some((c) => c.url.endsWith('/v1/council/runs'))).toBe(true);
    expect(screen.queryByText('No council session yet')).toBeNull();
    expect(screen.getByTestId('last-run-label').textContent).toMatch(
      /^Last council, 4 min ago, Live$/,
    );
    expect(screen.getByTestId('cb-verdict')).toBeTruthy();
    // strip on the board header shows the stored run's honest transport and models
    expect(screen.getByTestId('cs-transport').textContent).toContain('Gemini streaming text');
    expect(screen.getByTestId('cs-models').textContent).toContain('gemini-3.8-flash');
  });
  it('a stored demo run shows the demo banner on the board', async () => {
    fakeHub({ runs: [storedRunFixture({ mode: 'demo', kind: 'demo' })] });
    const store = createCouncilBoardStore();
    setBoardStore(store);
    render(
      <>
        <LastRunSync hub={HUB} />
        <CouncilBoard store={store} open onClose={() => undefined} hub={HUB} />
      </>,
    );
    await settle();
    await settle();
    expect(screen.getByTestId('cs-banner').textContent).toContain('DEMO: scripted, not Gemini');
    expect(screen.getByTestId('last-run-label').textContent).toContain('Demo');
  });
  it('room status: last-council label, or the empty state with Convene when none ever ran', async () => {
    fakeHub({ runs: [] });
    setCouncilHub(HUB);
    const { unmount } = render(<CouncilRoomStatus keys={['ask']} councilIds={['council:ask']} />);
    await settle();
    await settle();
    expect(screen.getByTestId('convene')).toBeTruthy();
    unmount();
    resetLastRuns();
    fakeHub({ runs: [storedRunFixture()] });
    render(<CouncilRoomStatus keys={['ask']} councilIds={['council:ask']} />);
    await settle();
    await settle();
    expect(screen.queryByTestId('convene')).toBeNull();
    expect(screen.getByTestId('last-run-label').textContent).toContain(
      'Last council, 4 min ago, Live',
    );
    expect(screen.getByTestId('cs-transport')).toBeTruthy();
  });
  it('Round Table "Convene" calls its own start, not the Ask council', async () => {
    fakeHub({ runs: [] });
    setCouncilHub(HUB);
    const onConvene = vi.fn();
    render(
      <CouncilRoomStatus
        keys={['roundtable']}
        councilIds={['council:roundtable']}
        noun="Round Table"
        onConvene={onConvene}
      />,
    );
    await settle();
    await settle();
    fireEvent.click(screen.getByTestId('convene'));
    expect(onConvene).toHaveBeenCalledOnce();
  });
});

describe('inspector with a stored run', () => {
  async function open(agent: string) {
    const board = createCouncilBoardStore();
    setBoardStore(board);
    const rec = storedRunFixture();
    setLastRuns([rec]);
    const store = createInspectorStore({ me: 's_ana' });
    hydrateFromHistory([rec], board, store);
    for (const a of rec.agents) store.seed(a.id);
    render(<InspectorPanel store={store} />);
    act(() => store.select(agent));
    await settle();
    return { store, rec };
  }
  it('an idle council agent says what the last council was, never a bare Idle', async () => {
    await open('council:ask-skeptic');
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.queryByText('Idle')).toBeNull();
    expect(screen.getAllByText(/Last council, 4 min ago, Live/).length).toBeGreaterThan(0);
  });
  it('Thinking shows the last public status instead of "no reasoning shared"', async () => {
    await open('council:ask-skeptic');
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.queryByText(/no reasoning shared/)).toBeNull();
    expect(screen.getByText(/Last said: Condition on the first toss/)).toBeTruthy();
  });
  it('Hierarchy shows the last run (chair, specialists, label) and Agents shows its A2A thread', async () => {
    await open('council:ask-chair');
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    const hier = screen.getByTestId('hierarchy');
    expect(within(hier).getByText(/Last council, 4 min ago, Live/)).toBeTruthy();
    expect(within(hier).getByRole('region', { name: 'Delegations out' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    expect(screen.getAllByText(/Skeptic|Teacher/).length).toBeGreaterThan(0);
  });
  it('with no run ever it says "Not part of a council run yet" everywhere', async () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.seed('council:ask-skeptic');
    render(<InspectorPanel store={store} />);
    act(() => store.select('council:ask-skeptic'));
    await settle();
    expect(screen.queryByText('Idle')).toBeNull();
    expect(screen.getAllByText('Not part of a council run yet').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getAllByText('Not part of a council run yet').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(screen.getByText('Not part of a council run yet.')).toBeTruthy();
  });
});

describe('agentNoteFrom', () => {
  it('finds the agent by id, voice key or room agent and carries only public words', () => {
    const rec = storedRunFixture();
    const now = rec.startedAt + 4 * 60_000;
    expect(agentNoteFrom({ runs: [rec] }, 'council:ask-teacher', now)?.said).toMatch(/Chapter 6/);
    expect(agentNoteFrom({ runs: [rec] }, 'skeptic', now)?.stance).toBe('Cautious');
    expect(agentNoteFrom({ runs: [rec] }, 'council:ask', now)?.label).toContain('Last council');
    expect(agentNoteFrom({ runs: [rec] }, 'student:s_ana', now)).toBeUndefined();
    expect(agentNoteFrom({ runs: [] }, 'council:ask-chair', now)).toBeUndefined();
  });
});
