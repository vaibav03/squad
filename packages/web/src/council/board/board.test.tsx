// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ASK_FIXTURE,
  ROUND_TABLE_FIXTURE,
  createCouncilBoardStore,
  playCouncilFixture,
  type CouncilBoardStore,
  type CouncilFixture,
} from '@squad/village/council';
import { CouncilBoard } from './CouncilBoard';
import { resultMode } from './mode-of';

const RAW = /council:[a-z]+-[a-z-]+|\bam_[a-z0-9]{6,}\b|\bcn_[a-z0-9]{6,}\b|\b[us]_[0-9a-f]{6,}\b/i;

beforeAll(() => {
  // jsdom has no layout or scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function loaded(fx: CouncilFixture = ASK_FIXTURE): CouncilBoardStore {
  const s = createCouncilBoardStore();
  playCouncilFixture(fx, (e) => s.apply(e), { instant: true });
  return s;
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
async function open(
  store: CouncilBoardStore,
  props: Partial<Parameters<typeof CouncilBoard>[0]> = {},
  view: 'feed' | 'timeline' = 'feed',
) {
  const onClose = vi.fn();
  render(<CouncilBoard store={store} open onClose={onClose} {...props} />);
  await settle();
  if (view === 'timeline') {
    const b = screen.queryByRole('button', { name: 'Handoff timeline' });
    if (b) fireEvent.click(b);
  }
  return { dlg: screen.getByRole('dialog'), onClose };
}

/** Every text node plus aria-label/title/alt under the body (and the live region). */
function scan(): string[] {
  const out: string[] = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n.textContent ?? '');
  document.body.querySelectorAll('*').forEach((el) => {
    for (const a of ['aria-label', 'title', 'alt', 'aria-valuetext', 'placeholder'])
      if (el.hasAttribute(a)) out.push(el.getAttribute(a) ?? '');
  });
  return out;
}

describe('Council board', () => {
  it('opens as a labelled modal dialog with phases, roster, ballot, decision and turn feed', async () => {
    const { dlg } = await open(loaded());
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-labelledby')).toBe('cb-title');
    const phases = within(dlg).getByRole('navigation', { name: 'Deliberation phases' });
    expect(within(phases).getByText('Gather evidence')).toBeTruthy();
    expect(within(phases).getByText('Debate')).toBeTruthy();
    expect(within(phases).getByText('Vote')).toBeTruthy();
    expect(within(phases).getByText('Synthesis')).toBeTruthy();
    expect(within(dlg).getByRole('region', { name: 'Who is on the council' })).toBeTruthy();
    expect(within(dlg).getByRole('region', { name: 'What they are saying' })).toBeTruthy();
    expect(within(dlg).getByTestId('dl-decision')).toBeTruthy();
    expect(within(dlg).getByTestId('dl-ballot')).toBeTruthy();
    expect(dlg.querySelectorAll('[data-testid=dl-member]').length).toBeGreaterThanOrEqual(4);
    // every seat has a portrait, never a letter tile
    expect(dlg.querySelectorAll('[data-testid=dl-member] .dl-portrait').length).toBeGreaterThanOrEqual(4);
    expect(dlg.querySelectorAll('.cb-tile')).toHaveLength(0);
    expect(within(dlg).getAllByText('Chair').length).toBeGreaterThan(0);
  });

  it('the phase header marks the current phase by icon, word and aria-current; done runs finish all four', async () => {
    const store = createCouncilBoardStore();
    const evs = ASK_FIXTURE.events.map((e) => e.event);
    for (const e of evs.slice(0, 5)) store.apply(e);
    await open(store);
    const now = document.querySelector('.dl-phase[aria-current=step]')!;
    expect(now.getAttribute('data-phase')).toBe('gather');
    expect(now.textContent).toContain('Now');
    cleanup();
    const { dlg } = await open(loaded());
    expect(dlg.querySelectorAll('.dl-phase[data-state=done]').length).toBe(4);
  });

  it('scripted fixtures always say Fixture, on the header, the roster and the decision', async () => {
    const { dlg } = await open(loaded());
    const head = dlg.querySelector('.cb-head .cb-mode')!;
    expect(head.textContent).toContain('Fixture');
    expect(head.textContent).not.toContain('Live');
    expect(dlg.querySelector('[data-testid=dl-member] .sq-schip')!.textContent).toContain(
      'Fixture',
    );
    expect(within(screen.getByTestId('dl-decision')).getByLabelText(/^Fixture/)).toBeTruthy();
    // icon and word, never colour alone
    expect(head.querySelector('.cb-mode__glyph svg')).toBeTruthy();
  });

  it('an empty store offers a labelled sample instead of a blank dialog', async () => {
    const store = createCouncilBoardStore();
    await open(store);
    expect(screen.getByText('No council has met yet')).toBeTruthy();
    // no hub here: Convene plays the scripted sample, and the strip says so out loud
    fireEvent.click(screen.getByRole('button', { name: 'Convene the council' }));
    await settle();
    expect(screen.getByTestId('dl-decision')).toBeTruthy();
  });

  it('Esc closes, and Tab never leaves the dialog', async () => {
    const { dlg, onClose } = await open(loaded());
    const close = within(dlg).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true });
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('turn cards: portrait, speaker, type badge, reply-to, turn number; rankings and the verdict are not turns', async () => {
    const { dlg } = await open(loaded());
    const feed = within(dlg).getByRole('feed');
    const cards = [...feed.querySelectorAll<HTMLElement>('article.dl-turn')];
    expect(cards.length).toBeGreaterThan(8);
    for (const c of cards) {
      expect(c.querySelector('.dl-portrait')).toBeTruthy();
      expect(c.querySelector('[data-testid=dl-turn-badge]')!.textContent).toMatch(
        /^(Proposal|Evidence|Challenge|Revision)$/,
      );
      expect(c.getAttribute('data-kind')).not.toMatch(/^(rank|vote|verdict|status)$/);
    }
    const ask = within(feed).getByRole('article', {
      name: /^Turn \d+\. Skeptic to Teacher: Evidence$/,
    });
    expect(ask.querySelector('[data-testid=dl-reply-to]')!.textContent).toContain(
      'Replying to Chair',
    );
    expect(ask.textContent).toMatch(/Turn \d+/);
    // a critique is a Challenge, and an answer to a critique would be a Revision
    expect(cards.some((c) => c.getAttribute('data-type') === 'challenge')).toBe(true);
    // the Teacher's answer cites a source: Evidence, with a citation chip
    expect(
      cards.some(
        (c) =>
          c.getAttribute('data-type') === 'evidence' &&
          c.querySelector('.sv-chip, [data-testid=citation-chip], button'),
      ),
    ).toBe(true);
  });

  it('feed filters by speaker and by turn type', async () => {
    const { dlg } = await open(loaded());
    const feed = within(dlg).getByRole('feed');
    const total = feed.querySelectorAll('article').length;
    fireEvent.change(within(dlg).getByLabelText('Type'), { target: { value: 'proposal' } });
    const props = feed.querySelectorAll('article');
    expect(props.length).toBeGreaterThan(0);
    expect(props.length).toBeLessThan(total);
    for (const r of props) expect(r.getAttribute('data-type')).toBe('proposal');
    fireEvent.change(within(dlg).getByLabelText('Type'), { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText('Speaker'), {
      target: {
        value: [...dlg.querySelectorAll('select option')]
          .find((o) => o.textContent === 'Teacher')!
          .getAttribute('value'),
      },
    });
    const mine = [...feed.querySelectorAll('article')];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(total);
    for (const r of mine) expect(r.textContent).toContain('Teacher');
    expect(screen.getByText(new RegExp(`Showing ${mine.length} of ${total} turns`))).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Clear filters' }));
    expect(feed.querySelectorAll('article').length).toBe(total);
  });

  it('arrow keys move focus through turn cards (roving tabindex)', async () => {
    const { dlg } = await open(loaded());
    const rows = [...dlg.querySelectorAll<HTMLElement>('article.dl-turn')];
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(rows[rows.length - 1]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: 'Enter' });
    expect(rows[0]!.getAttribute('data-hl')).toBe('true');
  });

  it('the ballot matrix: voters as columns, options as rows, numeric rank cells, legend in words', async () => {
    const { dlg } = await open(loaded());
    const b = within(dlg).getByTestId('dl-ballot');
    const table = within(b).getByRole('table');
    expect(within(table).getAllByRole('columnheader').length).toBeGreaterThanOrEqual(3);
    expect(within(table).getAllByRole('row').length).toBeGreaterThanOrEqual(3);
    const ranks = [...table.querySelectorAll('.dl-rank')].map((r) => r.textContent);
    expect(ranks.length).toBeGreaterThan(0);
    for (const r of ranks) expect(r).toMatch(/^\d+$/);
    expect(table.querySelector('.dl-rank svg')).toBeNull(); // icon-free numeric badges
    expect(b.textContent).toContain('Outlined: this voter ranked it differently');
    // rankings are not chat lines
    expect(dlg.querySelector('article.dl-turn[data-kind=rank]')).toBeNull();
  });

  it('roster: pressing a portrait opens one focused panel that swaps', async () => {
    const { dlg } = await open(loaded());
    const nodes = [
      ...dlg.querySelectorAll<HTMLElement>('[data-testid=dl-member] [data-testid=dl-portrait-btn]'),
    ];
    expect(nodes.every((n) => n.tagName === 'BUTTON')).toBe(true);
    const member = (name: string) =>
      [...dlg.querySelectorAll<HTMLElement>('[data-testid=dl-member]')]
        .find((n) => n.textContent?.includes(name))!
        .querySelector<HTMLElement>('[data-testid=dl-portrait-btn]')!;
    const skeptic = member('Skeptic');
    const teacher = member('Teacher');
    skeptic.focus();
    fireEvent.click(skeptic);
    let panel = screen.getByRole('dialog', { name: /^Skeptic/ });
    expect(screen.getAllByTestId('agent-focus-panel')).toHaveLength(1);
    expect(within(panel).getByRole('tab', { name: 'Conversation', selected: true })).toBeTruthy();
    fireEvent.click(teacher);
    panel = screen.getByRole('dialog', { name: /^Teacher/ });
    expect(screen.getAllByTestId('agent-focus-panel')).toHaveLength(1);
  });

  it('the handoff timeline view shows ALL communication; Esc closes the focused panel first, then the board', async () => {
    const store = loaded();
    const { dlg, onClose } = await open(store, {}, 'timeline');
    const tl = within(dlg).getByRole('region', { name: 'Handoff timeline' });
    expect(tl.getAttribute('data-filter')).toBe('all');
    expect(within(tl).getAllByTestId('af-row').length).toBe(store.run()!.messages.length);
    const node = [...dlg.querySelectorAll<HTMLElement>('[data-testid=dl-member]')]
      .find((n) => n.textContent?.includes('Skeptic'))!
      .querySelector<HTMLElement>('[data-testid=dl-portrait-btn]')!;
    node.focus();
    fireEvent.click(node);
    await settle();
    const panel = screen.getByRole('dialog', { name: /^Skeptic/ });
    const sel = within(panel).getByRole('button', { name: 'Selected agent' });
    expect(sel.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(panel.querySelector('h2')!, { key: 'Escape' });
    await settle();
    expect(screen.queryByTestId('agent-focus-panel')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(node);
  });

  it('the decision card: outcome, consensus, confidence in words, provenance, missing evidence, dissent, CTAs', async () => {
    const { dlg } = await open(loaded());
    const v = screen.getByTestId('dl-decision');
    expect(within(v).getByTestId('dl-outcome').textContent).toBeTruthy();
    expect(within(v).getByTestId('dl-consensus').textContent).toMatch(
      /Majority|Unanimous|Split|Not recorded/,
    );
    expect(within(v).getByTestId('dl-confidence').textContent).toMatch(
      /Sure|Fairly sure|Unsure|Not stated/,
    );
    expect(v.textContent).not.toMatch(/\d+\s*%/);
    expect(within(v).getByTestId('dl-provenance').textContent).toMatch(/Scripted fixture/);
    expect(within(v).getByRole('group', { name: 'Missing evidence' })).toBeTruthy();
    for (const name of ['Add proof text', 'Ask follow-up', 'Send to chat', 'Add to plan'])
      expect(within(v).getByRole('button', { name })).toBeTruthy();
    const dissent = within(v).getByRole('group', { name: 'Dissent' });
    fireEvent.click(within(dissent).getByRole('button', { name: 'See their turn' }));
    await settle();
    const hl = dlg.querySelector('article.dl-turn[data-hl=true]')!;
    expect(hl).toBeTruthy();
    expect(hl.getAttribute('data-kind')).toBe('answer');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('dissent jump clears a filter that hides the target turn', async () => {
    const { dlg } = await open(loaded());
    fireEvent.change(within(dlg).getByLabelText('Type'), { target: { value: 'challenge' } });
    const v = screen.getByTestId('dl-decision');
    fireEvent.click(within(v).getByRole('button', { name: 'See their turn' }));
    await settle();
    expect((within(dlg).getByLabelText('Type') as HTMLSelectElement).value).toBe('');
    expect(dlg.querySelector('article.dl-turn[data-hl=true]')).toBeTruthy();
  });

  it('Ask follow-up drafts a message mentioning @nook and the run id in the group chat composer', async () => {
    const store = loaded();
    const drafts: string[] = [];
    const on = (e: Event) => drafts.push((e as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener('squad:chat-prefill', on);
    const { onClose } = await open(store);
    fireEvent.click(
      within(screen.getByTestId('dl-decision')).getByRole('button', { name: 'Ask follow-up' }),
    );
    window.removeEventListener('squad:chat-prefill', on);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toContain('@nook');
    expect(drafts[0]).toContain(store.run()!.runId);
    expect(onClose).toHaveBeenCalled();
  });

  it('Add proof text opens a composer; asking again goes through the ask API with the proof attached', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init?.body ? { body: String(init.body) } : {}) });
      return new Response(
        JSON.stringify({
          id: 'cn_proof0000001',
          status: 'running',
          streamUrl: '/s',
          resultUrl: '/r',
        }),
        { status: 200 },
      );
    });
    await open(loaded(), { hub: { hubUrl: 'http://hub.test', token: 'tok' } });
    const v = screen.getByTestId('dl-decision');
    fireEvent.click(within(v).getByRole('button', { name: 'Add proof text' }));
    const box = within(v).getByRole('textbox') as HTMLTextAreaElement;
    const ask = within(v).getByRole('button', {
      name: 'Ask again with this proof',
    }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'Ch6 p.4: E0 = 1 + E0/2 + E1/2.' } });
    expect(ask.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(ask);
    });
    await settle();
    const post = calls.find((c) => c.url.endsWith('/v1/council/ask'))!;
    const sent = JSON.parse(post.body!) as { question: string };
    expect(sent.question).toContain('Proof I am adding');
    expect(sent.question).toContain('Ch6 p.4');
    expect(screen.getByTestId('dl-decision-status').textContent).toContain(
      'Asked the council again',
    );
  });

  it('proof text over the ask limit is blocked with the count in words', async () => {
    await open(loaded(), { hub: { hubUrl: 'http://hub.test', token: 'tok' } });
    const v = screen.getByTestId('dl-decision');
    fireEvent.click(within(v).getByRole('button', { name: 'Add proof text' }));
    fireEvent.change(within(v).getByRole('textbox'), { target: { value: 'x'.repeat(700) } });
    expect(v.textContent).toMatch(/\d+ characters over the 600 limit/);
    expect(
      (within(v).getByRole('button', { name: 'Ask again with this proof' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('portraits are real buttons, announce the seam event, and open the focused panel for that seat', async () => {
    const seen: string[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent<{ agentId: string }>).detail.agentId);
    window.addEventListener('squad:agent-panel-open', on);
    const { dlg } = await open(loaded());
    const btn = dlg.querySelector<HTMLElement>(
      '[data-testid=dl-member] [data-testid=dl-portrait-btn]',
    )!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-label')).toMatch(/^Open .+\u2019s panel$/);
    fireEvent.click(btn);
    window.removeEventListener('squad:agent-panel-open', on);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^council:/);
    expect(screen.getAllByTestId('agent-focus-panel')).toHaveLength(1);
  });

  it('every portrait on the surface (turn cards, ballot, decision) opens the same single panel', async () => {
    const { dlg } = await open(loaded());
    const sources = [
      '[data-testid=dl-feed] [data-testid=dl-portrait-btn]',
      '[data-testid=dl-ballot] [data-testid=dl-portrait-btn]',
      '[data-testid=dl-decision] [data-testid=dl-portrait-btn]',
    ];
    for (const sel of sources) {
      const b = dlg.querySelector<HTMLElement>(sel);
      expect(b, sel).toBeTruthy();
      fireEvent.click(b!);
      expect(screen.getAllByTestId('agent-focus-panel')).toHaveLength(1);
    }
  });

  it('action items: sending needs a hub; without one the buttons are off and say why', async () => {
    await open(loaded());
    const v = screen.getByTestId('dl-decision');
    expect(
      (within(v).getByRole('button', { name: 'Send to chat' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(v.textContent).toContain('Sign in to a hub');
  });

  it('action items: replays never send', async () => {
    await open(loaded(), { hub: { hubUrl: 'http://x', token: 't' }, replay: true });
    const v = screen.getByTestId('dl-decision');
    expect(
      (within(v).getByRole('button', { name: 'Add to plan' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(v.textContent).toContain('recorded replay');
  });

  it('action items: Send to chat and Add to plan call the hub action endpoints by id', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init?.body ? { body: String(init.body) } : {}) });
      return new Response(JSON.stringify({ ok: true, added: true }), { status: 200 });
    });
    const store = loaded();
    await open(store, { hub: { hubUrl: 'http://hub.test', token: 'tok' } });
    const v = screen.getByTestId('dl-decision');
    const items = store.run()!.verdict!.actionItems;
    await act(async () => {
      fireEvent.click(within(v).getByRole('button', { name: 'Send to chat' }));
    });
    await settle();
    expect(within(v).getByTestId('dl-decision-status').textContent).toMatch(
      /Sent to the squad chat|Sent 2 of 2/,
    );
    await act(async () => {
      fireEvent.click(within(v).getByRole('button', { name: 'Add to plan' }));
    });
    await settle();
    const acts = calls.filter((c) => c.url.includes('/actions/'));
    const run = store.run()!.runId;
    expect(acts.map((c) => c.url)).toEqual([
      ...items.map(() => `http://hub.test/v1/council/${run}/actions/chat`),
      ...items.map(() => `http://hub.test/v1/council/${run}/actions/plan`),
    ]);
    expect(JSON.parse(acts[items.length]!.body!)).toEqual({ actionId: items[0]!.id });
    expect(calls.some((c) => c.url.includes('/v1/chat/'))).toBe(false);
  });

  it('action items: a failure shows a plain message; pending disables the button', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise<Response>((r) => {
          release = r;
        }),
    );
    await open(loaded(), { hub: { hubUrl: 'http://hub.test', token: 'tok' } });
    const v = screen.getByTestId('dl-decision');
    const btn = () =>
      within(v).getByRole('button', { name: /^(Add to plan|Adding)/ }) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(btn());
    });
    expect(btn().disabled).toBe(true);
    expect(btn().textContent).toBe('Adding...');
    await act(async () => {
      release(
        new Response(JSON.stringify({ ok: false, error: { code: 'no_plan', message: 'raw' } }), {
          status: 409,
        }),
      );
    });
    await settle();
    expect(within(v).getByTestId('dl-decision-status').textContent).toMatch(/no study plan yet/);
    expect(btn().disabled).toBe(false);
  });

  it('auto-scroll pauses on user scroll and offers Jump to latest with a count', async () => {
    const store = loaded();
    const { dlg } = await open(store);
    const scroller = dlg.querySelector<HTMLElement>('.dl-feed__scroll')!;
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
    // user scrolls up: jsdom has zero layout, so fake the metrics
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await settle();
    // a new spoken turn arrives while paused
    act(() => {
      const run = store.run()!;
      store.apply({
        t: 'a2a.message',
        msg: {
          id: 'am_zzzzzzzzzz01',
          correlationId: run.runId,
          seq: 999,
          from: run.agents.find((a) => a.role === 'chair')!.id,
          to: run.agents.find((a) => a.role !== 'chair')!.id,
          kind: 'ask',
          stage: 'done',
          summary: 'One more thing.',
          status: 'done',
          mode: 'demo',
          source: 'script',
          redaction: 'public',
          ts: 1,
        },
      });
    });
    await settle();
    expect(scroller.scrollTop).toBe(100);
    const jump = screen.getByRole('button', { name: /Jump to latest \(1 new\)/ });
    fireEvent.click(jump);
    await settle();
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
  });

  it('announces new messages and steps by display name, never raw ids', async () => {
    const store = createCouncilBoardStore();
    const evs = ASK_FIXTURE.events.map((e) => e.event);
    for (const e of evs.slice(0, 4)) store.apply(e);
    await open(store);
    const live = document.querySelector('[aria-live="polite"]')!;
    for (const e of evs.slice(4, 10)) {
      await act(async () => store.apply(e));
      await settle();
    }
    expect(live.textContent).toMatch(/Chair|Skeptic|Teacher|Practitioner|Step:/);
    expect(live.textContent).not.toMatch(RAW);
  });

  it('shows the round table council too, with a Fixture badge', async () => {
    await open(loaded(ROUND_TABLE_FIXTURE));
    expect(document.querySelector('.cb-head .cb-mode')!.textContent).toContain('Fixture');
  });

  it('a mixed-mode run is as honest as its worst agent', async () => {
    const store = createCouncilBoardStore();
    const live = (id: string, from: string, to: string, mode: string, kind = 'answer') => ({
      t: 'a2a.message',
      msg: {
        id,
        correlationId: 'cn_live00000001',
        seq: Number(id.slice(-2)),
        from,
        to,
        kind,
        stage: 'opinions',
        summary: 'Said something.',
        status: 'done',
        mode,
        source: mode === 'live' ? 'model' : 'script',
        redaction: 'public',
        ts: 1,
      },
    });
    store.apply(live('am_000000000001', 'council:ask-skeptic', 'council:ask-chair', 'live'));
    store.apply(
      live('am_000000000002', 'council:ask-teacher', 'council:ask-chair', 'degraded:rate_limited'),
    );
    await open(store);
    const head = document.querySelector('.cb-head .cb-mode')!;
    expect(head.textContent).toBe('Degraded: rate limited');
  });

  it('no raw ids reach the screen on any board surface', async () => {
    for (const fx of [ASK_FIXTURE, ROUND_TABLE_FIXTURE]) {
      cleanup();
      const { dlg } = await open(loaded(fx), { focusAgent: loaded(fx).run()!.agents[0]!.id });
      for (const step of ['all', 'challenge', 'proposal', 'evidence'] as const) {
        const sel = within(dlg).getByLabelText('Type') as HTMLSelectElement;
        const has = [...sel.options].some((o) => o.value === step);
        fireEvent.change(sel, { target: { value: step === 'all' || !has ? '' : step } });
        for (const t of scan()) expect(t, `${fx.name} ${step}`).not.toMatch(RAW);
      }
      for (const btn of dlg.querySelectorAll<HTMLElement>(
        '[data-testid=dl-member] [data-testid=dl-portrait-btn]',
      )) {
        fireEvent.click(btn);
        for (const t of scan()) expect(t).not.toMatch(RAW);
      }
    }
  });

  it('turn cards never carry thinking text: only public summary, stance and position', async () => {
    const store = loaded();
    const run = store.run()!;
    for (const m of run.messages)
      for (const k of Object.keys(m))
        expect(k).not.toMatch(/thought|reason|scratch|raw|signature|cot/i);
  });
});

describe('resultMode', () => {
  it('demo is always Fixture, a missing member is Degraded, otherwise Live', () => {
    expect(resultMode({ demo: true, members: [] })).toBe('demo');
    expect(resultMode({ demo: false, members: [{ status: 'failed' } as never] })).toMatch(
      /^degraded:/,
    );
    expect(resultMode({ demo: false, members: [{ status: 'answered' } as never] })).toBe('live');
  });
});
