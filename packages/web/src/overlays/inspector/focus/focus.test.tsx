// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  ASK_FIXTURE,
  createCouncilBoardStore,
  playCouncilFixture,
  type A2aMessage,
} from '@squad/village/council';
import { createInspectorStore } from '@squad/village/inspector';
import { InspectorPanel } from '../index';
import { setBoardStore } from '../../../council/board/bridge';
import { resetLastRuns, setLastRuns } from '../../../council/last-run/store';
import { HandoffTimeline } from './HandoffTimeline';
import { ReasoningCardView } from './ReasoningCards';
import { reasoningCards } from '@squad/village/council';

const RAW = /council:[a-z]+-[a-z-]+|\bam_[a-z0-9]{6,}\b|\bcn_[a-z0-9]{6,}\b/i;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  setBoardStore(null);
  resetLastRuns();
});
const settle = async (ms = 80) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function boot(opts: { run?: boolean } = {}) {
  const board = createCouncilBoardStore();
  if (opts.run !== false) playCouncilFixture(ASK_FIXTURE, (e) => board.apply(e), { instant: true });
  setBoardStore(board);
  const store = createInspectorStore({ me: 's_ana' });
  for (const a of board.run()?.agents ?? []) store.seed(a.id);
  store.seed('council:ask-skeptic');
  return { board, store };
}
const SK = 'council:ask-skeptic';
const TE = 'council:ask-teacher';

describe('focused agent panel: selection', () => {
  it('opens a dialog titled "<name> — <role>" on Conversation with provider state and a Close button', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select(SK));
    await settle();
    const dlg = screen.getByRole('dialog', { name: 'Skeptic — Specialist' });
    expect(dlg.getAttribute('aria-modal')).toBe('false');
    expect(within(dlg).getByRole('heading', { level: 2 }).textContent).toBe('Skeptic — Specialist');
    expect(within(dlg).getByRole('tab', { name: 'Conversation', selected: true })).toBeTruthy();
    expect(within(dlg).getByTestId('af-provider').textContent).toMatch(/FIXTURE: scripted, not Gemini/);
    expect(within(dlg).getByTestId('af-provider').textContent).toMatch(/Scripted \(not Gemini\)/);
    expect(within(dlg).getByRole('button', { name: /Close/ }).tagName).toBe('BUTTON');
    expect(dlg.textContent).toMatch(/Status\s*Done/);
  });
  it('selecting another agent swaps the panel in place: one dialog, announced politely, tab kept', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select(SK));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Reasoning summary' }));
    act(() => store.select(TE));
    await settle();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: /^Teacher/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Reasoning summary', selected: true })).toBeTruthy();
    const live = document.querySelector('.af-sr[role="status"]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Now showing Teacher');
  });
  it('a sender chip in the timeline swaps the focused agent', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select(SK));
    await settle();
    const who = screen.getAllByTestId('af-who')[0]!;
    const chip = within(who).getAllByRole('button')[0]!;
    fireEvent.click(chip);
    expect(store.selected).not.toBe(SK);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('live announcement binds to the selected agent', () => {
  const live = () => document.querySelector('.af-sr[role="status"]')!.textContent;
  it('a tab change announces "<Selected agent>: <tab>" and another agent state event never changes it', async () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.seed('council:debate');
    store.seed('expert:ch6');
    render(<InspectorPanel store={store} />);
    act(() => store.select('council:debate'));
    await settle(300);
    fireEvent.click(screen.getByRole('tab', { name: /^Reasoning summary/ }));
    await settle(30);
    expect(live()).toBe('Debate council: Reasoning summary');
    // a Chapter 6 expert state event mid-stream
    act(() => store.apply({ t: 'agent.state', agent: 'expert:ch6', state: 'studying' }));
    fireEvent.click(screen.getByRole('tab', { name: /^Team/ }));
    await settle(30);
    expect(live()).toBe('Debate council: Team');
    expect(live()).not.toMatch(/Chapter 6/);
    expect(screen.getByRole('dialog', { name: /^Debate council/ })).toBeTruthy();
    // selection moves: the announcement follows the selection
    act(() => store.select('expert:ch6'));
    await settle(300);
    expect(live()).toBe('Now showing Chapter 6 expert');
    fireEvent.click(screen.getByRole('tab', { name: /^Structure/ }));
    await settle(30);
    expect(live()).toBe('Chapter 6 expert: Structure');
  });
});

describe('Next keeps the tab and swaps the art', () => {
  it('Prev/Next keep the selected tab, change the portrait, and the live text names the new agent', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select('council:ask-chair'));
    await settle(300);
    fireEvent.click(screen.getByRole('tab', { name: /^Team/ }));
    const art = () => document.querySelector('.ai-portrait img')!.getAttribute('src');
    const before = art();
    // walk until the focused agent changes to one with a different role
    for (let i = 0; i < 5 && art() === before; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Next agent' }));
      await settle(30);
    }
    expect(store.selected).not.toBe('council:ask-chair');
    expect(art()).not.toBe(before);
    expect(screen.getByRole('tab', { name: 'Team', selected: true })).toBeTruthy();
  });
});

describe('empty states carry time, source, mode and a way forward', () => {
  it('a council agent with no run: As of time, Source, Mode, state badge and two CTAs; Structure explains itself', async () => {
    const { store } = boot({ run: false });
    render(<InspectorPanel store={store} />);
    act(() => store.select(SK));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Structure' }));
    expect(screen.getByText(/Structure shows who reports to whom/)).toBeTruthy();
    const meta = screen.getAllByTestId('af-meta')[0]!;
    expect(meta.textContent).toMatch(/As of/);
    expect(meta.textContent).toMatch(/Source/);
    expect(meta.textContent).toMatch(/Mode/);
    expect(meta.querySelector('time')!.getAttribute('title')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Start a council' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Ask Cubbie' }).length).toBeGreaterThan(0);
  });
});

describe('focused agent panel: filtering and ordering', () => {
  it('defaults to Selected agent (only their messages) and All communication shows the whole run', async () => {
    const { store, board } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select(SK));
    await settle();
    const sel = screen.getByRole('button', { name: 'Selected agent' });
    const all = screen.getByRole('button', { name: 'All communication' });
    expect(sel.getAttribute('aria-pressed')).toBe('true');
    expect(all.getAttribute('aria-pressed')).toBe('false');
    const mine = screen.getAllByTestId('af-row');
    for (const r of mine) expect(within(r).getByTestId('af-who').textContent).toMatch(/Skeptic/);
    fireEvent.click(all);
    expect(all.getAttribute('aria-pressed')).toBe('true');
    const everything = screen.getAllByTestId('af-row');
    expect(everything.length).toBe(board.run()!.messages.length);
    expect(everything.length).toBeGreaterThan(mine.length);
  });
  it('rows are chronological, labelled Sender → Recipient, with purpose and status, never raw ids', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select(SK));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'All communication' }));
    const rows = screen.getAllByTestId('af-row');
    const nums = rows.map((r) => Number(/#(\d+)/.exec(r.querySelector('.af-n')!.textContent!)![1]));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    expect(rows[0]!.textContent).toMatch(/Purpose: /);
    expect(rows[0]!.textContent).toMatch(/Status: /);
    expect(rows.some((r) => /Chair\s*→\s*to\s*Skeptic/.test(r.querySelector('[data-testid=af-who]')!.textContent!) || /Chair.*Skeptic/.test(r.textContent!))).toBe(true);
    const timeline = screen.getByRole('region', { name: 'Handoff timeline' });
    expect(timeline.textContent).not.toMatch(RAW);
    for (const l of screen.getAllByRole('list')) expect(l.getAttribute('aria-label') ?? '').not.toMatch(RAW);
  });
  it('orders out-of-order envelopes by seq, then ts, then id and groups by stage', () => {
    const chair = 'council:ask-chair';
    const mk = (id: string, seq: number, ts: number, o: Partial<A2aMessage>): A2aMessage => ({
      id,
      correlationId: 'cn_t',
      seq,
      from: chair,
      to: SK,
      kind: 'delegate',
      stage: 'delegation',
      summary: id,
      status: 'done',
      mode: 'live',
      source: 'model',
      redaction: 'public',
      ts,
      ...o,
    });
    const board = createCouncilBoardStore();
    for (const m of [
      mk('am_c', 2, 5, {}),
      mk('am_a', 2, 5, { from: SK, to: chair, kind: 'answer', stage: 'opinions' }),
      mk('am_b', 1, 9, {}),
      mk('am_d', 2, 3, { from: SK, to: chair, kind: 'answer', stage: 'opinions' }),
    ])
      board.apply({ t: 'a2a.message', msg: m });
    render(<HandoffTimeline run={board.run()} defaultFilter="all" />);
    expect(screen.getAllByTestId('af-row').map((r) => r.getAttribute('data-id'))).toEqual([
      'am_b',
      'am_d',
      'am_a',
      'am_c',
    ]);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.firstChild!.textContent)).toEqual([
      'Delegation',
      'Opinions',
      'Delegation',
    ]);
  });
});

describe('no raw ids on the focused panel', () => {
  it('no tab of any council agent leaks an id into text, aria-label or title', async () => {
    const { store, board } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    for (const a of board.run()!.agents) {
      act(() => store.select(a.id));
      await settle();
      for (const tab of ['Activity', 'Reasoning summary', 'Conversation', 'Team', 'Structure']) {
        fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
        const dlg = screen.getByRole('dialog');
        const texts = [dlg.textContent ?? ''];
        dlg.querySelectorAll('*').forEach((el) => {
          for (const k of ['aria-label', 'title']) texts.push(el.getAttribute(k) ?? '');
        });
        for (const t of texts) expect(t, `${a.name} ${tab}`).not.toMatch(RAW);
      }
    }
  });
});

describe('focused agent panel: keyboard', () => {
  it('Escape closes the panel and returns focus to the control that opened it', async () => {
    const { store } = boot();
    const opener = document.createElement('button');
    opener.textContent = 'Skeptic chip';
    document.body.appendChild(opener);
    render(<InspectorPanel store={store} />);
    opener.focus();
    act(() => store.select(SK));
    await settle();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle(400);
    expect(store.selected).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it('Arrow keys move between tabs (roving tabindex, aria-selected)', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} />);
    act(() => store.select(SK));
    await settle();
    const conv = screen.getByRole('tab', { name: 'Conversation' });
    expect(conv.getAttribute('tabindex')).toBe('0');
    const sel = (n: string) => screen.getByRole('tab', { name: n, selected: true });
    fireEvent.keyDown(conv, { key: 'ArrowRight' });
    expect(sel('Team')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Conversation' }).getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(sel('Team'), { key: 'ArrowRight' });
    expect(sel('Structure')).toBeTruthy();
    fireEvent.keyDown(sel('Structure'), { key: 'ArrowRight' });
    expect(sel('Activity')).toBeTruthy();
    fireEvent.keyDown(sel('Activity'), { key: 'ArrowLeft' });
    expect(sel('Structure')).toBeTruthy();
    fireEvent.keyDown(sel('Structure'), { key: 'Home' });
    expect(sel('Activity')).toBeTruthy();
    fireEvent.keyDown(sel('Activity'), { key: 'End' });
    expect(sel('Structure')).toBeTruthy();
    // the five tabs, in this order, with exactly these names
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Activity',
      'Reasoning summary',
      'Conversation',
      'Team',
      'Structure',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('tab', { name: 'Conversation' }).id,
    );
  });
});

describe('focused agent panel: empty states', () => {
  it('no run ever: "No messages involving <name> yet" with Start a council and Ask Cubbie', async () => {
    const { store } = boot({ run: false });
    render(<InspectorPanel store={store} />);
    act(() => store.select(SK));
    await settle();
    expect(screen.getByText('No messages involving Skeptic yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a council' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask Cubbie' })).toBeTruthy();
    expect(screen.getByText('No council has run yet', { exact: false })).toBeTruthy();
    // no hub: honest example-mode badge
    expect(screen.getAllByTestId('af-help-badge')[0]!.textContent).toBe(
      'Example mode: scripted, not Gemini',
    );
    // every tab has its own useful empty state, never a dead end
    for (const tab of ['Activity', 'Reasoning summary', 'Team', 'Structure']) {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
      expect(screen.queryAllByTestId('af-help').length, tab).toBeGreaterThan(0);
    }
  });
  it('a non-council agent gets "Ask Cubbie about <topic>" instead of a dead end', async () => {
    const store = createInspectorStore({ me: 's_ana' });
    store.apply({ t: 'agent.state', agent: 'expert:ch6', state: 'studying' });
    render(<InspectorPanel store={store} />);
    act(() => store.select('expert:ch6'));
    await settle();
    expect(screen.getByRole('button', { name: /^Ask Cubbie about Chapter 6 expert/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start a council' })).toBeNull();
  });
  it('a persisted last run shows "Last council: <time>, <mode>" instead', async () => {
    const { store } = boot({ run: false });
    setLastRuns([
      {
        id: 'cn_last',
        councilKey: 'ask',
        startedAt: Date.now() - 4 * 60_000,
        mode: 'live',
        status: 'done',
        stage: 'done',
        agents: [],
        messages: [],
        counters: { messages: 0, delegations: 0 },
      } as never,
    ]);
    render(<InspectorPanel store={store} />);
    act(() => store.select(SK));
    await settle();
    expect(screen.getByTestId('af-last-run').textContent).toBe('Last council: 4 min ago, Live');
    expect(screen.queryByRole('button', { name: 'Convene the council' })).toBeNull();
  });
  it('an agent with no messages in a run says so, and the All filter still lists the run', async () => {
    const board = createCouncilBoardStore();
    playCouncilFixture(ASK_FIXTURE, (e) => board.apply(e), { instant: true });
    const run = board.run()!;
    render(
      <HandoffTimeline
        run={run}
        agent={{ id: 'x', name: 'Nobody', is: () => false }}
        defaultFilter="selected"
      />,
    );
    expect(screen.getByText('No messages involving Nobody yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All communication' }));
    expect(screen.getAllByTestId('af-row').length).toBe(run.messages.length);
  });
});

describe('reasoning summary cards (Decisions)', () => {
  it('show Goal, Evidence, Decision, Next step, the fixed footer and Scripted example', async () => {
    const { store } = boot();
    render(<InspectorPanel store={store} mode="replay" />);
    act(() => store.select('council:ask-chair'));
    await settle();
    fireEvent.click(screen.getByRole('tab', { name: 'Reasoning summary' }));
    const cards = screen.getAllByTestId('af-reasoning');
    expect(cards.length).toBeGreaterThan(0);
    const c = cards[cards.length - 1]!;
    for (const k of ['Goal', 'Evidence', 'Decision', 'Next step'])
      expect(within(c).getByText(k)).toBeTruthy();
    expect(c.textContent).toContain('Summary shared by the agent. Private reasoning is never shown.');
    expect(within(c).getByTestId('af-scripted').textContent).toBe('Scripted example');
    expect(screen.getByTestId('af-verdict')).toBeTruthy();
  });
  it('privacy guard: nothing outside the public envelope fields can render', () => {
    const m = {
      id: 'am_1',
      correlationId: 'cn_t',
      seq: 1,
      from: SK,
      to: 'council:ask-chair',
      kind: 'answer',
      stage: 'opinions',
      summary: 'Public words.',
      status: 'done',
      mode: 'live',
      source: 'model',
      redaction: 'public',
      ts: 1,
      thought: 'SECRET-THOUGHT',
      thinking: 'SECRET-THINKING',
      systemPrompt: 'SECRET-PROMPT',
      scratch: 'SECRET-SCRATCH',
    } as unknown as A2aMessage;
    const [card] = reasoningCards([m], { agent: SK });
    const { container } = render(<ReasoningCardView c={card!} />);
    expect(container.textContent).toContain('Public words.');
    expect(container.textContent).not.toMatch(/SECRET/);
    expect(container.textContent).not.toMatch(/Scripted example/);
    const t = render(<HandoffTimeline run={{ ...createCouncilBoardStore().run()!, messages: [m] } as never} defaultFilter="all" />);
    expect(t.container.textContent).not.toMatch(/SECRET/);
  });
});
