// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { councilVerdictText, type CouncilAskResponse, type CouncilResult } from '@squad/core';
import { CouncilCard, CouncilChatCard } from './CouncilCard';
import { CouncilPanel } from './CouncilPanel';
import {
  CouncilClientError,
  type CouncilStreamHandlers,
  type CouncilTransport,
} from './council-client';
import { councilFixtures as f } from './fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  // jsdom has no layout: let the focus trap and presence run
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});

const ASK: CouncilAskResponse = {
  id: f.done.id,
  status: 'running',
  streamUrl: `/v1/council/${f.done.id}/stream`,
  resultUrl: `/v1/council/${f.done.id}`,
};

function mock(over: Partial<CouncilTransport> = {}) {
  const box: { h?: CouncilStreamHandlers } = {};
  const t: CouncilTransport = {
    ask: vi.fn(async () => ASK),
    get: vi.fn(async () => f.done),
    stream: vi.fn((_r, h) => {
      box.h = h;
      return () => {};
    }),
    ...over,
  };
  const step = (r: CouncilResult) => act(() => box.h!.onStep(r));
  return { t, step, box };
}

const input = () => screen.getByRole('textbox', { name: 'Ask the council' }) as HTMLTextAreaElement;
const type = (s: string) => fireEvent.change(input(), { target: { value: s } });
const sendBtn = () => screen.getByRole('button', { name: 'Ask the council' });

async function askAndWait(m: ReturnType<typeof mock>, q = 'Which approach for problem 3?') {
  type(q);
  fireEvent.click(sendBtn());
  await waitFor(() => expect(m.t.stream).toHaveBeenCalled());
}

describe('CouncilPanel: empty state and input', () => {
  it('is a dialog named by its heading, with copy, an input, a counter and three sample chips', () => {
    render(<CouncilPanel hub={null} transport={mock().t} />);
    expect(screen.getByRole('dialog', { name: 'Ask the council' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Ask the council' })).toBeTruthy();
    expect(input().maxLength).toBe(600);
    expect(screen.getByText('0 / 600')).toBeTruthy();
    const chips = within(screen.getByRole('group', { name: 'Sample questions' })).getAllByRole(
      'button',
    );
    expect(chips.map((c) => c.textContent)).toEqual([
      'B or C?',
      'Is this proof right?',
      'Which approach should I use for problem 3?',
    ]);
    expect((sendBtn() as HTMLButtonElement).disabled).toBe(true);
  });

  it('fills the input from a chip and counts characters', () => {
    render(<CouncilPanel hub={null} transport={mock().t} />);
    fireEvent.click(screen.getByRole('button', { name: 'Is this proof right?' }));
    expect(input().value).toBe('Is this proof right?');
    expect(screen.getByText('20 / 600')).toBeTruthy();
    expect((sendBtn() as HTMLButtonElement).disabled).toBe(false);
  });

  it('Enter sends the trimmed question; Shift+Enter does not', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} chatId="dm:s_ana" />);
    type('  B or C?  ');
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true });
    expect(m.t.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(m.t.ask).toHaveBeenCalledWith('B or C?', 'dm:s_ana'));
  });

  it('does not send a question shorter than 3 characters', () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    type('ab');
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(m.t.ask).not.toHaveBeenCalled();
  });

  it('Esc closes the panel and returns focus', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    const onClose = vi.fn();
    const { rerender } = render(
      <CouncilPanel
        hub={null}
        transport={mock().t}
        open
        onClose={onClose}
        returnFocusTo={opener}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(input()));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <CouncilPanel
        hub={null}
        transport={mock().t}
        open={false}
        onClose={onClose}
        returnFocusTo={opener}
      />,
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('closes itself on Esc when uncontrolled', async () => {
    render(<CouncilPanel hub={null} transport={mock().t} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 1500 });
  });
});

describe('CouncilPanel: a run', () => {
  it('shows "is thinking..." skeletons while waiting, polite, with a skip button', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    const waiting = screen.getByLabelText('Waiting for');
    expect(waiting.getAttribute('aria-live')).toBe('polite');
    expect(within(waiting).getByText('Skeptic is thinking...')).toBeTruthy();
    expect(within(waiting).getByText('Teacher is thinking...')).toBeTruthy();
    expect(within(waiting).getByText('Practitioner is thinking...')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip to verdict' })).toBeTruthy();
    expect(screen.getByText('Which approach for problem 3?')).toBeTruthy();
  });

  it('puts a member on screen as they arrive, announces it, and shows verified sources', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    await m.step({ ...f.opinions, members: [f.opinions.members[1]!, f.opinions.members[0]!] });
    const card = screen.getByText(/Chapter 6 solves this exact pattern/).closest('article')!;
    expect(within(card).getByText('Teacher')).toBeTruthy();
    expect(
      within(card).getByText('Explains from the course materials, one step at a time.'),
    ).toBeTruthy();
    expect(within(card).getByText('ch6.pdf p.4')).toBeTruthy();
    expect(screen.getByRole('status', { name: '' }).textContent).toMatch(
      /Teacher answered: Recursion on states/,
    );
    // the second member waits for the first one's reading time
    expect(screen.queryByText(/Conditioning on the first toss is safer/)).toBeNull();
    // the other seats still say they are thinking
    expect(screen.queryByText('Teacher is thinking...')).toBeNull();
    expect(screen.getByText('Practitioner is thinking...')).toBeTruthy();
  });

  it('notes a struck claim on the member card', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    await m.step({ ...f.opinions, members: [f.opinions.members[0]!] });
    expect(screen.getByText('1 claim dropped: no verified quote')).toBeTruthy();
  });

  it('skip shows the ranking and the verdict, moves focus to the verdict, and keeps confidence in words', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    await m.step(f.done);
    fireEvent.click(screen.getByRole('button', { name: 'Skip to verdict' }));

    expect(await screen.findByText('Teacher ranks: Practitioner, then Skeptic')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ranking' })).toBeTruthy();

    const verdict = screen.getByRole('heading', {
      level: 3,
      name: /^Verdict:\s*Use a recursion on states/,
    });
    await waitFor(() => expect(document.activeElement).toBe(verdict));

    const section = verdict.closest('section')!;
    expect(within(section).getByText('Fairly sure')).toBeTruthy();
    expect(within(section).getByText(/Two of three members chose states/)).toBeTruthy();
    expect(section.textContent).not.toMatch(/\d+\s?%|0\.\d/);
    // the dissent has its own labelled block with member, view and why
    const dissent = within(section).getByRole('complementary', { name: 'Dissent from Skeptic' });
    expect(dissent.textContent).toMatch(/Condition on the first toss instead/);
    expect(dissent.textContent).toMatch(/second recursion/);
    expect(within(section).getByText('What to do next')).toBeTruthy();
    // all three members are on screen, the skip button is gone, and a new question is offered
    for (const n of ['Skeptic', 'Teacher', 'Practitioner'])
      expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Skip to verdict' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask something else' })).toBeTruthy();
  });

  it('never shows scores, xp or streaks anywhere', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    await m.step(f.done);
    fireEvent.click(screen.getByRole('button', { name: 'Skip to verdict' }));
    await screen.findByRole('heading', { name: /^Verdict:/ });
    expect(screen.getByRole('dialog').textContent).not.toMatch(
      /\bxp\b|streak|score|points|level up/i,
    );
  });

  it('copies the plain-text verdict and says Copied', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText }, onLine: true });
    render(<CouncilCard result={f.done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy verdict' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(councilVerdictText(f.done));
  });

  it('falls back to selectable text when the clipboard is blocked', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      onLine: true,
    });
    render(<CouncilCard result={f.done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy verdict' }));
    const area = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    expect(area.value).toBe(councilVerdictText(f.done));
    expect(area.readOnly).toBe(true);
    expect(screen.getByText(/Copying is blocked here/)).toBeTruthy();
  });

  it('asks another question from the finished state, keeping a clean form', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    await m.step(f.done);
    fireEvent.click(screen.getByRole('button', { name: 'Skip to verdict' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask something else' }));
    expect(input().value).toBe('');
  });
});

describe('CouncilPanel: verdict variants', () => {
  it('uncertain: shows the TA treatment, general-reasoning notes, and a silent member', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    await m.step(f.uncertain);
    fireEvent.click(screen.getByRole('button', { name: 'Skip to verdict' }));
    const verdict = await screen.findByRole('heading', { name: /^Verdict:/ });
    const section = verdict.closest('section')!;
    expect(section.getAttribute('data-uncertain')).toBe('true');
    expect(within(section).getByText('Uncertain, ask your TA')).toBeTruthy();
    expect(
      within(section).getByText('Not in the course materials, so this is general reasoning.'),
    ).toBeTruthy();
    expect(
      within(section).getByText('Practitioner did not answer: two members voted.'),
    ).toBeTruthy();
    expect(screen.getByText('Practitioner did not answer this time.')).toBeTruthy();
  });

  it('demo: shows the demo badge', () => {
    render(<CouncilCard result={f.demo} />);
    expect(screen.getByText('Demo')).toBeTruthy();
    cleanup();
    render(<CouncilCard result={f.done} />);
    expect(screen.queryByText('Demo')).toBeNull();
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('a verdict without dissent renders no dissent block', () => {
    const { dissent: _d, ...rest } = f.done.verdict!;
    render(<CouncilCard result={{ ...f.done, verdict: rest }} />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('CouncilPanel: error states', () => {
  it('error: fixed copy and retry re-sends the same question', async () => {
    const ask = vi
      .fn<CouncilTransport['ask']>()
      .mockRejectedValueOnce(new CouncilClientError('failed'))
      .mockResolvedValue(ASK);
    const m = mock({ ask });
    render(<CouncilPanel hub={null} transport={m.t} />);
    type('What now?');
    fireEvent.click(sendBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/The council could not be reached\. Try again\./);
    expect(alert.textContent).not.toMatch(/failed|500|Error/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[1]![0]).toBe('What now?');
    await waitFor(() => expect(m.t.stream).toHaveBeenCalled());
  });

  it.each([
    ['busy', 'The council is already deliberating. Wait for it to finish.'],
    ['rate_limited', 'You have asked a lot of questions. Try again in a bit.'],
  ] as const)('%s shows its fixed copy', async (kind, copy) => {
    const m = mock({ ask: vi.fn(async () => Promise.reject(new CouncilClientError(kind))) });
    render(<CouncilPanel hub={null} transport={m.t} />);
    type('Anything');
    fireEvent.click(sendBtn());
    expect((await screen.findByRole('alert')).textContent).toContain(copy);
  });

  it('offline: says so, offers retry and edit', async () => {
    const m = mock({ ask: vi.fn(async () => Promise.reject(new CouncilClientError('offline'))) });
    render(<CouncilPanel hub={null} transport={m.t} />);
    type('Anything');
    fireEvent.click(sendBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No connection/);
    expect(alert.textContent).toMatch(/You are offline/);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit question' }));
    expect(input().value).toBe('Anything');
  });

  it('no hub at all: offline-style error rather than a crash', async () => {
    render(<CouncilPanel hub={null} />);
    type('Anything');
    fireEvent.click(sendBtn());
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('refused: shows the message and no member cards', async () => {
    const m = mock({
      ask: vi.fn(async () => ({ ...ASK, status: 'refused' as const })),
      get: vi.fn(async () => f.refused),
    });
    render(<CouncilPanel hub={null} transport={m.t} />);
    type('Give me the exam answers');
    fireEvent.click(sendBtn());
    await screen.findByText(/does not answer questions about live exams/);
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByText('Skeptic is thinking...')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('failed: shows the message and retry', async () => {
    const m = mock({
      ask: vi.fn(async () => ({ ...ASK, status: 'failed' as const })),
      get: vi.fn(async () => f.failed),
    });
    render(<CouncilPanel hub={null} transport={m.t} />);
    type('Anything');
    fireEvent.click(sendBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not finish this one/);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('a broken stream falls back to loading the result', async () => {
    const m = mock();
    render(<CouncilPanel hub={null} transport={m.t} />);
    await askAndWait(m);
    act(() => m.box.h!.onError());
    await waitFor(() => expect(m.t.get).toHaveBeenCalledWith(f.done.id));
    fireEvent.click(await screen.findByRole('button', { name: 'Skip to verdict' }));
    expect(await screen.findByRole('heading', { name: /^Verdict:/ })).toBeTruthy();
  });
});

describe('CouncilCard and CouncilChatCard', () => {
  it('shows the question, verdict, confidence and next step, with members behind a disclosure', () => {
    render(<CouncilCard result={f.done} />);
    expect(screen.getByText(f.done.question)).toBeTruthy();
    expect(screen.getByText('Fairly sure')).toBeTruthy();
    expect(screen.getByText('What to do next')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /Show how each member answered/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Chapter 6 solves this exact pattern/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Chapter 6 solves this exact pattern/)).toBeTruthy();
    expect(screen.getByText('Teacher ranks: Practitioner, then Skeptic')).toBeTruthy();
  });

  it('loads a run by id, with a loading state first', async () => {
    const get = vi.fn(async (_u: string) => new Response(JSON.stringify(f.done), { status: 200 }));
    vi.stubGlobal('fetch', get);
    render(<CouncilChatCard hub={{ hubUrl: 'http://hub.test', token: 't' }} runId={f.done.id} />);
    expect(screen.getByRole('status', { name: 'Loading council answer' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /^Verdict:/ })).toBeTruthy();
    expect(get.mock.calls[0]![0]).toBe(`http://hub.test/v1/council/${f.done.id}`);
  });

  it('shows fixed error copy and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":{"code":"boom","message":"secret"}}', { status: 500 }),
      )
      .mockResolvedValue(new Response(JSON.stringify(f.done), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CouncilChatCard hub={{ hubUrl: 'http://hub.test', token: 't' }} runId={f.done.id} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toMatch(/secret|500|boom/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: /^Verdict:/ })).toBeTruthy();
  });

  it('renders refused and failed cards with their message', () => {
    render(<CouncilCard result={f.refused} />);
    expect(screen.getByText(/does not answer questions about live exams/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Show how each member/ })).toBeNull();
  });
});
