// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNCIL_KEY_FIX } from '@squad/core';
import { createCouncilBoardStore } from '@squad/village/council';
import { createInspectorStore } from '@squad/village/inspector';
import { InspectorPanel } from '../../overlays/inspector/InspectorPanel';
import { CouncilBoard } from '../board/CouncilBoard';
import { setBoardStore } from '../board/bridge';
import { storedRunFixture } from '../fixtures';
import { CouncilStatusStrip } from '../status/CouncilStatusStrip';
import { CouncilRoomStatus, EmptyCouncilState } from './components';
import { setCouncilHub } from './hub';
import { resetLastRuns, setLastRuns } from './store';
import { hydrateFromHistory } from './useCouncilRuns';

/** No raw ids (student/agent/message/run ids) in any text node or accessible attribute of the new surfaces. */
const RAW =
  /\b[us]_[0-9a-f]{6,}\b|\bU [a-z0-9]{8,}\b|council:[a-z]+-[a-z-]+|\bam_[a-z0-9]{6,}\b|\bcn_[a-z0-9]{8,}\b/i;

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
const clean = (label: string) => {
  for (const t of scan()) expect(t, `${label} :: ${t.slice(0, 80)}`).not.toMatch(RAW);
};
const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

afterEach(() => {
  cleanup();
  setBoardStore(null);
  setCouncilHub(null);
  resetLastRuns();
  vi.unstubAllGlobals();
});

describe('no raw ids on the council live-ux surfaces', () => {
  it('status strip, empty state and room status', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }));
    const rec = storedRunFixture();
    render(
      <CouncilStatusStrip
        status={{
          provider: 'Google Gemini',
          generatedAt: 1,
          key: { state: 'ok', fix: COUNCIL_KEY_FIX.ok },
          defaultTransport: 'stream',
          models: { fast: 'f', main: 'm', chair: 'c', live: null },
          transports: {
            stream: { available: true, label: 'Gemini streaming text' },
            live: { enabled: false, state: 'untested', label: 'off' },
          },
          demo: { forced: false },
          a2a: { runs: 1, messages: 8, delegations: 2, activeRuns: 0 },
        }}
        run={{
          mode: rec.mode,
          transport: rec.transport,
          agents: rec.agents,
          counters: { messages: 8, delegations: 2, stage: 'done' },
        }}
        variant="full"
      />,
    );
    clean('strip');
    cleanup();
    render(<EmptyCouncilState />);
    clean('empty');
    cleanup();
    setLastRuns([rec]);
    render(<CouncilRoomStatus keys={['ask']} councilIds={['council:ask']} />);
    await settle();
    clean('room status');
  });

  it('board and inspector tabs with a stored run', async () => {
    const rec = storedRunFixture();
    setLastRuns([rec]);
    const board = createCouncilBoardStore();
    setBoardStore(board);
    const insp = createInspectorStore({ me: 's_ana' });
    hydrateFromHistory([rec], board, insp);
    for (const a of rec.agents) insp.seed(a.id);
    render(
      <>
        <CouncilBoard store={board} open onClose={() => undefined} />
        <InspectorPanel store={insp} />
      </>,
    );
    await settle();
    clean('board');
    for (const id of rec.agents.map((a) => a.id)) {
      act(() => insp.select(id));
      await settle();
      for (const tab of ['Conversation', 'Activity', 'Decisions']) {
        fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
        clean(`${id} ${tab}`);
      }
    }
  }, 60_000);
});
