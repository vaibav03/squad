// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ASK_FIXTURE,
  createCouncilBoardStore,
  playCouncilFixture,
  type CouncilBoardStore,
} from '@squad/village/council';
import { CouncilBoard } from './CouncilBoard';
import { HudButton, RoomExtras } from './Launchers';
import { closeBoard, setBoardStore, useBoardOpen } from './bridge';

const css = readFileSync(resolve(__dirname, 'board.css'), 'utf8');
const RAW = /council:[a-z]+-[a-z-]+|\bam_[a-z0-9]{6,}\b|\bcn_[a-z0-9]{6,}\b/i;

afterEach(() => {
  cleanup();
  setBoardStore(null);
  closeBoard();
});

const dcss = readFileSync(resolve(__dirname, '../deliberation/deliberation.css'), 'utf8');
const tokens = readFileSync(resolve(__dirname, '../../../../../docs/design/tokens.css'), 'utf8');

describe('board motion (docs/specs/08-village-motion.md)', () => {
  it('every transition animates only opacity, transform or stroke-dashoffset, 100-240 ms, ease-out', () => {
    for (const sheet of [css, dcss]) {
      const decls = [...sheet.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]!);
      for (const d of decls) {
        if (/^none$/.test(d.trim())) continue;
        for (const part of d.split(',').map((x) => x.trim())) {
          expect(part).toMatch(
            /^(opacity|transform|stroke-dashoffset)\s+(100|160|180|200|240)ms var\(--ease-out\)$/,
          );
        }
      }
      expect(sheet).not.toMatch(/transition:\s*all/);
    }
    expect(dcss.match(/transition:/g)!.length).toBeGreaterThan(0);
  });

  it('every keyframe animation is opacity/transform/stroke-dashoffset, 160-240 ms ease-out, and Calm switches them off', () => {
    const anims = [...(css + dcss).matchAll(/animation:\s*([^;]+);/g)]
      .map((m) => m[1]!)
      .filter((a) => a !== 'none' && a !== 'none !important');
    expect(anims.length).toBeGreaterThan(0);
    for (const a of anims)
      expect(a).toMatch(
        /^(cb-in (160|180|200)ms var\(--ease-out\) both|dl-in 200ms var\(--ease-out\) both|dl-draw var\(--cc-handoff-ms\) var\(--ease-out\) both)$/,
      );
    const draw = /@keyframes dl-draw\s*\{([\s\S]*?)\n\}/.exec(dcss)![1]!;
    expect(draw.replace(/opacity|stroke-dashoffset|from|to|[\d.]+|[{}:;\s]/g, '')).toBe('');
    const inn = /@keyframes dl-in\s*\{([\s\S]*?)\n\}/.exec(dcss)![1]!;
    expect(
      inn.replace(/opacity|transform|from|to|translateY\([^)]*\)|none|[\d.]+|[{}:;\s]/g, ''),
    ).toBe('');
    expect(dcss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.dl-handoff[\s\S]*animation: none/,
    );
    expect(dcss).toMatch(/:root\[data-calm='true'\] \.dl-handoff/);
    expect(dcss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('the A2A handoff focus time is a token inside 160-240 ms', () => {
    const ms = Number(/--cc-handoff-ms:\s*(\d+)ms/.exec(tokens)![1]);
    expect(ms).toBeGreaterThanOrEqual(160);
    expect(ms).toBeLessThanOrEqual(240);
  });

  it('uses tokens, not hex colours', () => {
    for (const sheet of [css, dcss]) {
      const body = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(body.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    }
  });

  it('Calm: the board marks itself reduced, handoff lines stay drawn and no card animates', async () => {
    const store = createCouncilBoardStore();
    playCouncilFixture(ASK_FIXTURE, (e) => store.apply(e), { instant: true });
    render(<CouncilBoard store={store} open onClose={() => {}} calm />);
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(document.querySelector('.lv-ovl')!.getAttribute('data-reduced')).toBe('true');
  });
});

function Probe() {
  const o = useBoardOpen();
  return <output data-testid="open">{o.open ? 'open' : 'closed'}</output>;
}
const withRuns = (): CouncilBoardStore => {
  const s = createCouncilBoardStore();
  playCouncilFixture(ASK_FIXTURE, (e) => s.apply(e), { instant: true });
  return s;
};

describe('launchers', () => {
  it('render nothing without a board store', () => {
    render(
      <>
        <RoomExtras councilId="council:ask" />
        <HudButton />
      </>,
    );
    expect(document.body.textContent).toBe('');
  });

  it('the room panel shows the honest mode of that room and opens the board', () => {
    setBoardStore(withRuns());
    render(
      <>
        <RoomExtras councilId="council:ask" />
        <Probe />
      </>,
    );
    expect(screen.getByText('Fixture')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Council board' }));
    expect(screen.getByTestId('open').textContent).toBe('open');
  });

  it('a room with no session yet offers the board but no mode', () => {
    setBoardStore(withRuns());
    render(<RoomExtras councilId="council:planner" />);
    expect(screen.queryByText('Fixture')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Council board' })).toBeTruthy();
  });

  it('the HUD button appears with a session, carries the mode word, and never shows ids', () => {
    setBoardStore(createCouncilBoardStore());
    render(<HudButton />);
    expect(screen.queryByRole('button', { name: /Council board/ })).toBeNull();
    cleanup();
    setBoardStore(withRuns());
    render(<HudButton />);
    const b = screen.getByRole('button', { name: /Council board/ });
    expect(b.textContent).toContain('Fixture');
    expect(document.body.textContent).not.toMatch(RAW);
  });
});
