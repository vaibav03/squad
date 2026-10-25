// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CouncilResult } from '@squad/core';
import { ASK_FIXTURE, createCouncilBoardStore, playCouncilFixture } from '@squad/village/council';
import { CouncilCard, CouncilChatCard } from './CouncilCard';
import { CouncilPanel } from './CouncilPanel';
import { councilFixtures as f } from './fixtures';
import { fixtureTransport } from './fixtures';
import { RunStrip, stageWords } from './RunStrip';
import { RoomExtras } from './board/Launchers';
import { setBoardStore, useBoardOpen } from './board/bridge';
import * as client from './council-client';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  setBoardStore(null);
  vi.restoreAllMocks();
});

const msg = (id: string, seq: number, stage: string, from: string, to: string, kind: string) => ({
  id,
  correlationId: f.done.id,
  seq,
  from,
  to,
  kind,
  stage,
  status: 'done',
  mode: 'live',
  source: 'model',
  redaction: 'public',
  ts: 1,
  summary: `line ${seq}`,
});
const v2 = (over: Partial<CouncilResult> = {}): CouncilResult => ({
  ...f.done,
  demo: false,
  mode: 'degraded:no_turn',
  stage: 'opinions',
  agents: [
    { id: 'council:ask-chair', role: 'chair', displayName: 'Chair', mode: 'live', transport: 'stream-text', status: 'done' },
    { id: 'council:ask-teacher', role: 'specialist', parent: 'council:ask-chair', displayName: 'Teacher', mode: 'degraded:no_turn', transport: 'stream-text', status: 'failed' },
  ],
  messages: [
    msg('am_a', 0, 'question', 'council:ask-chair', 'room', 'status'),
    msg('am_b', 1, 'delegation', 'council:ask-chair', 'council:ask-teacher', 'delegate'),
  ],
  ...over,
});

describe('RunStrip', () => {
  it('shows the run mode, the current step in words and every agent with its state', () => {
    render(<RunStrip result={v2()} />);
    expect(screen.getByText('Degraded: no turn')).toBeTruthy();
    expect(screen.getByText('Step 3 of 7: Opinions')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Who is on the council' });
    expect(within(list).getByText('Teacher').parentElement!.textContent).toContain('did not answer');
    expect(within(list).getByText('Chair').parentElement!.textContent).toContain('answered');
  });
  it('legacy runs (no mode/stage/agents) fall back to the member-based badge and no list', () => {
    const { mode: _m, stage: _s, agents: _a, messages: _x, ...legacy } = v2();
    render(<RunStrip result={{ ...legacy, demo: true } as CouncilResult} />);
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
    expect(stageWords({ stage: undefined, status: 'done' })).toBeUndefined();
    expect(stageWords({ stage: 'done', status: 'done' })).toBe('All steps done');
    expect(stageWords({ stage: 'question', status: 'refused' })).toBeUndefined();
  });
});

describe('council chat card', () => {
  it('shows the mode badge and opens the board in place on a live run', () => {
    render(<CouncilCard result={v2()} />);
    expect(screen.getByText('Degraded: no turn', { selector: '.cb-mode__word' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open council board' }));
    const dlg = screen.getByRole('dialog');
    // the board header carries the CURRENT state, not the opening line
    expect(within(dlg).getByRole('heading', { level: 2 }).textContent).toBe('Ask council');
    expect(dlg.textContent).toContain('Waiting');
  });
  it('a legacy result without envelopes offers no board', () => {
    const { stage: _s, agents: _a, messages: _x, ...legacy } = v2();
    render(<CouncilCard result={legacy as CouncilResult} />);
    expect(screen.queryByRole('button', { name: 'Open council board' })).toBeNull();
  });
  it('the board streams: later polls move the stage and show the verdict state', async () => {
    const polls = [v2({ status: 'running' }), v2({ stage: 'done', status: 'done' })];
    let n = 0;
    vi.spyOn(client, 'getCouncil').mockImplementation(async () => polls[Math.min(n++, 1)]!);
    vi.useFakeTimers();
    render(<CouncilChatCard hub={{} as never} runId={f.done.id} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(10)));
    fireEvent.click(screen.getByRole('button', { name: 'Open council board' }));
    expect(screen.getByRole('dialog').textContent).toContain('Step 3 of 7');
    await act(async () => void (await vi.advanceTimersByTimeAsync(1600)));
    vi.useRealTimers();
    expect(screen.getByRole('dialog').textContent).toMatch(/All 7 steps done/);
  });
});

describe('panels and the shared board', () => {
  it('the Council Hall panel shows mode, stage and agents while a run plays', async () => {
    const { t } = { t: fixtureTransport({ ...f, done: v2({ status: 'running' }) } as never) };
    void t;
    render(<CouncilPanel hub={null} transport={streamed(v2({ status: 'running' }))} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Ask the council' }), {
      target: { value: 'Mean or median?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask the council' }));
    expect(await screen.findByText('Step 3 of 7: Opinions')).toBeTruthy();
    expect(screen.getByText('Degraded: no turn', { selector: '.cb-mode__word' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Who is on the council' })).toBeTruthy();
  });

  it('with the village board mounted the result is folded into it and the button opens it on the run', async () => {
    const store = createCouncilBoardStore();
    setBoardStore(store);
    function Probe() {
      const o = useBoardOpen();
      return <output data-testid="o">{o.open ? `open:${o.runId}` : 'closed'}</output>;
    }
    render(
      <>
        <CouncilCard result={v2()} />
        <Probe />
      </>,
    );
    expect(store.run()!.runId).toBe(f.done.id);
    expect(store.run()!.stage).toBe('opinions');
    fireEvent.click(screen.getByRole('button', { name: 'Open council board' }));
    expect(screen.getByTestId('o').textContent).toBe(`open:${f.done.id}`);
  });

  it('Round Table room finds a live roundtable run and shows its mode', () => {
    const store = createCouncilBoardStore();
    setBoardStore(store);
    store.apply({
      t: 'a2a.message',
      msg: msg('am_r', 0, 'question', 'council:roundtable-chairman', 'room', 'status'),
    });
    render(<RoomExtras councilId={['council:roundtable', 'council:planner']} />);
    expect(screen.getByText('Live')).toBeTruthy();
    const run = store.run()!;
    expect(run.agents[0]!.cast).toBe('chair');
  });

  it('the board header shows the verdict (not the opening line) after a replay finishes', async () => {
    const store = createCouncilBoardStore();
    playCouncilFixture(ASK_FIXTURE, (e) => store.apply(e), { instant: true });
    const { CouncilBoard } = await import('./board/CouncilBoard');
    render(<CouncilBoard store={store} open onClose={() => {}} />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    const head = document.querySelector('.cb-status')!;
    expect(head.textContent).not.toMatch(/Question received|Planning who to ask/);
    expect(head.textContent).toContain('Result');
  });
});

/** A transport whose stream immediately delivers one snapshot. */
function streamed(r: CouncilResult): client.CouncilTransport {
  return {
    ask: async () => ({
      id: r.id,
      status: 'running',
      streamUrl: `/v1/council/${r.id}/stream`,
      resultUrl: `/v1/council/${r.id}`,
    }),
    get: async () => r,
    stream: (_id, h) => {
      setTimeout(() => h.onStep(r), 0);
      return () => {};
    },
  };
}
