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

describe('board motion (docs/specs/08-village-motion.md)', () => {
  it('every transition animates only opacity and transform, 160-200 ms, ease-out', () => {
    const decls = [...css.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]!);
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      if (/^none$/.test(d.trim())) continue;
      for (const part of d.split(',').map((x) => x.trim())) {
        expect(part).toMatch(/^(opacity|transform)\s+(160|180|200)ms var\(--ease-out\)$/);
      }
    }
    expect(css).not.toMatch(/transition:\s*all/);
  });

  it('every keyframe animation is opacity/transform, 160-200 ms ease-out, and Calm switches them off', () => {
    const anims = [...css.matchAll(/animation:\s*([^;]+);/g)]
      .map((m) => m[1]!)
      .filter((a) => a !== 'none');
    expect(anims.length).toBeGreaterThan(0);
    for (const a of anims) expect(a).toMatch(/^cb-in (160|180|200)ms var\(--ease-out\) both$/);
    const frames = /@keyframes cb-in\s*\{([\s\S]*?)\n\}/.exec(css)![1]!;
    expect(
      frames.replace(/opacity|transform|from|to|translateY\([^)]*\)|none|[\d.]+|[{}:;\s]/g, ''),
    ).toBe('');
    expect(css).toMatch(/\.lv-ovl\[data-reduced='true'\] \.cb-row/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(
      /\.lv-ovl\[data-reduced='true'\] \.cb-edge__lit\s*\{[^}]*transition:\s*none/,
    );
  });

  it('uses tokens, not hex colours, outside the dark-theme override', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(body.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual(['#b9adff', '#b9adff']);
  });

  it('Calm: the board marks itself reduced, the lit edge stays drawn and no row animates', async () => {
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
    expect(screen.getByText('Demo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Council board' }));
    expect(screen.getByTestId('open').textContent).toBe('open');
  });

  it('a room with no session yet offers the board but no mode', () => {
    setBoardStore(withRuns());
    render(<RoomExtras councilId="council:planner" />);
    expect(screen.queryByText('Demo')).toBeNull();
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
    expect(b.textContent).toContain('Demo');
    expect(document.body.textContent).not.toMatch(RAW);
  });
});
