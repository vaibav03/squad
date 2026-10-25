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
) {
  const onClose = vi.fn();
  render(<CouncilBoard store={store} open onClose={onClose} {...props} />);
  await settle();
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
  it('opens as a labelled modal dialog with the org chart, stepper, feed and verdict', async () => {
    const { dlg } = await open(loaded());
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-labelledby')).toBe('cb-title');
    expect(within(dlg).getByRole('navigation', { name: 'Decision flow' })).toBeTruthy();
    expect(within(dlg).getByRole('region', { name: 'Council org chart' })).toBeTruthy();
    expect(within(dlg).getByRole('region', { name: 'Message feed' })).toBeTruthy();
    expect(within(dlg).getByTestId('cb-verdict')).toBeTruthy();
    const nodes = dlg.querySelectorAll('.cb-node');
    expect(nodes.length).toBeGreaterThanOrEqual(4);
    expect(within(dlg).getAllByText('Chair').length).toBeGreaterThan(0);
  });

  it('scripted fixtures always say Demo, on the header, the cards and the verdict', async () => {
    const { dlg } = await open(loaded());
    const head = dlg.querySelector('.cb-head .cb-mode')!;
    expect(head.textContent).toContain('Demo');
    expect(head.textContent).not.toContain('Live');
    expect(dlg.querySelector('.cb-node .cb-mode')!.textContent).toContain('Demo');
    expect(within(screen.getByTestId('cb-verdict')).getByText('Demo')).toBeTruthy();
    // glyph and word, never colour alone
    expect(head.querySelector('.cb-mode__glyph')!.textContent).not.toBe('');
  });

  it('an empty store offers a labelled sample instead of a blank dialog', async () => {
    const store = createCouncilBoardStore();
    await open(store);
    expect(screen.getByText('No council session yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show a sample (Demo)' }));
    await settle();
    expect(screen.getByTestId('cb-verdict')).toBeTruthy();
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

  it('feed rows read "Skeptic to Chair: Kind" and filter by agent and by kind', async () => {
    const { dlg } = await open(loaded());
    const feed = within(dlg).getByRole('feed');
    const total = feed.querySelectorAll('article').length;
    expect(total).toBeGreaterThan(8);
    expect(
      within(feed).getAllByRole('article', { name: /^Skeptic to Teacher: Asks$/ }).length,
    ).toBe(1);
    fireEvent.change(within(dlg).getByLabelText('Kind'), { target: { value: 'delegate' } });
    const del = feed.querySelectorAll('article');
    expect(del.length).toBe(3);
    for (const r of del) expect(r.getAttribute('data-kind')).toBe('delegate');
    fireEvent.change(within(dlg).getByLabelText('Kind'), { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText('Agent'), {
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
    expect(
      screen.getByText(new RegExp(`Showing ${mine.length} of ${total} messages`)),
    ).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Clear filters' }));
    expect(feed.querySelectorAll('article').length).toBe(total);
  });

  it('indents replies under the message they answer', async () => {
    const { dlg } = await open(loaded());
    const depths = [...dlg.querySelectorAll('article.cb-row')].map((r) =>
      Number(r.getAttribute('data-depth')),
    );
    expect(Math.max(...depths)).toBeGreaterThanOrEqual(2);
    expect(depths[0]).toBe(0);
  });

  it('arrow keys move focus through feed rows (roving tabindex)', async () => {
    const { dlg } = await open(loaded());
    const rows = [...dlg.querySelectorAll<HTMLElement>('article.cb-row')];
    expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
    rows[0]!.focus();
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1]!, { key: 'End' });
    expect(document.activeElement).toBe(rows[rows.length - 1]);
    fireEvent.keyDown(rows[rows.length - 1]!, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0]!, { key: 'Enter' });
    expect(rows[0]!.classList.contains('is-hl')).toBe(true);
  });

  it('org chart: selecting an agent filters the feed, with arrow-key movement between agents', async () => {
    const { dlg } = await open(loaded());
    const nodes = [...dlg.querySelectorAll<HTMLElement>('.cb-node')];
    const skeptic = nodes.find((n) => n.textContent?.includes('Skeptic'))!;
    fireEvent.click(skeptic);
    expect(skeptic.getAttribute('aria-pressed')).toBe('true');
    for (const r of dlg.querySelectorAll('article.cb-row'))
      expect(r.textContent).toContain('Skeptic');
    nodes[0]!.focus();
    fireEvent.keyDown(nodes[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(nodes[1]);
  });

  it('verdict: confidence in words, dissent linked to the dissenting message', async () => {
    const { dlg } = await open(loaded());
    const v = screen.getByTestId('cb-verdict');
    expect(v.querySelector('.cb-conf')!.textContent).toMatch(
      /Confidence\s+(Sure|Fairly sure|Unsure)/,
    );
    expect(v.textContent).not.toMatch(/\d+\s*%/);
    const dissent = within(v).getByRole('group', { name: 'Dissent' });
    fireEvent.click(within(dissent).getByRole('button', { name: 'See their message' }));
    await settle();
    const hl = dlg.querySelector('article.cb-row.is-hl')!;
    expect(hl).toBeTruthy();
    expect(hl.getAttribute('data-kind')).toBe('answer');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('dissent jump clears a filter that hides the target row', async () => {
    const { dlg } = await open(loaded());
    fireEvent.change(within(dlg).getByLabelText('Kind'), { target: { value: 'delegate' } });
    const v = screen.getByTestId('cb-verdict');
    fireEvent.click(within(v).getByRole('button', { name: 'See their message' }));
    await settle();
    expect((within(dlg).getByLabelText('Kind') as HTMLSelectElement).value).toBe('');
    expect(dlg.querySelector('article.cb-row.is-hl')).toBeTruthy();
  });

  it('action items: sending needs a hub; without one the buttons are off and say why', async () => {
    await open(loaded());
    const v = screen.getByTestId('cb-verdict');
    const send = within(v).getAllByRole('button', { name: /^Send to chat/ });
    expect(send.length).toBeGreaterThan(0);
    expect((send[0] as HTMLButtonElement).disabled).toBe(true);
    expect(v.textContent).toContain('Sign in to a hub');
  });

  it('action items: replays never send', async () => {
    await open(loaded(), { hub: { hubUrl: 'http://x', token: 't' }, replay: true });
    const v = screen.getByTestId('cb-verdict');
    expect(
      (within(v).getAllByRole('button', { name: /^Add to plan/ })[0] as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(v.textContent).toContain('recorded replay');
  });

  it('action items: Send to chat and Add to plan go through the chat-send helper', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init?.body ? { body: String(init.body) } : {}) });
      if (String(url).endsWith('/v1/chat/chats'))
        return new Response(JSON.stringify({ chats: [{ id: 'c1', kind: 'group' }] }), {
          status: 200,
        });
      return new Response('{}', { status: 200 });
    });
    await open(loaded(), { hub: { hubUrl: 'http://hub.test', token: 'tok' } });
    const v = screen.getByTestId('cb-verdict');
    await act(async () => {
      fireEvent.click(within(v).getAllByRole('button', { name: /^Send to chat/ })[0]!);
    });
    await settle();
    expect(within(v).getByRole('status').textContent).toBe('Sent to the squad chat.');
    await act(async () => {
      fireEvent.click(within(v).getAllByRole('button', { name: /^Add to plan/ })[0]!);
    });
    await settle();
    expect(within(v).getByRole('status').textContent).toContain('add that to your plan');
    const sends = calls.filter((c) => c.url.endsWith('/v1/chat/send'));
    expect(sends).toHaveLength(2);
    expect(JSON.parse(sends[1]!.body!).text).toMatch(/^@cubbie add to my study plan: /);
  });

  it('auto-scroll pauses on user scroll and offers Jump to latest with a count', async () => {
    const store = loaded();
    const { dlg } = await open(store);
    const scroller = dlg.querySelector<HTMLElement>('.cb-feed__scroll')!;
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();
    // user scrolls up: jsdom has zero layout, so fake the metrics
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
    scroller.scrollTop = 100;
    fireEvent.scroll(scroller);
    await settle();
    // a new message arrives while paused
    act(() => {
      const run = store.run()!;
      store.apply({
        t: 'a2a.message',
        msg: {
          id: 'am_zzzzzzzzzz01',
          correlationId: run.runId,
          seq: 999,
          from: run.agents.find((a) => a.role === 'chair')!.id,
          to: 'room',
          kind: 'status',
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

  it('shows the round table council too, with a Demo badge', async () => {
    await open(loaded(ROUND_TABLE_FIXTURE));
    expect(document.querySelector('.cb-head .cb-mode')!.textContent).toContain('Demo');
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
    expect(head.textContent).toBe('▲Degraded: rate limited');
  });

  it('no raw ids reach the screen on any board surface', async () => {
    for (const fx of [ASK_FIXTURE, ROUND_TABLE_FIXTURE]) {
      cleanup();
      const { dlg } = await open(loaded(fx), { focusAgent: loaded(fx).run()!.agents[0]!.id });
      for (const step of ['all', 'critique', 'delegate', 'verdict'] as const) {
        fireEvent.change(within(dlg).getByLabelText('Kind'), {
          target: { value: step === 'all' ? '' : step },
        });
        for (const t of scan()) expect(t, `${fx.name} ${step}`).not.toMatch(RAW);
      }
      for (const node of dlg.querySelectorAll<HTMLElement>('.cb-node')) {
        fireEvent.click(node);
        for (const t of scan()) expect(t).not.toMatch(RAW);
      }
    }
  });

  it('feed rows never carry thinking text: only public summary, stance and position', async () => {
    const store = loaded();
    const run = store.run()!;
    for (const m of run.messages)
      for (const k of Object.keys(m))
        expect(k).not.toMatch(/thought|reason|scratch|raw|signature|cot/i);
  });
});

describe('resultMode', () => {
  it('demo is always Demo, a missing member is Degraded, otherwise Live', () => {
    expect(resultMode({ demo: true, members: [] })).toBe('demo');
    expect(resultMode({ demo: false, members: [{ status: 'failed' } as never] })).toMatch(
      /^degraded:/,
    );
    expect(resultMode({ demo: false, members: [{ status: 'answered' } as never] })).toBe('live');
  });
});
