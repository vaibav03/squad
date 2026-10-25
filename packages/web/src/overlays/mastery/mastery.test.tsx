// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { publishMastery, type MasteryChapter } from '@squad/village/rooms';
import { MasteryLayer } from './MasteryLayer';
import { MasteryPanel } from './MasteryPanel';
import { MasterySummary } from './MasterySummary';
import { masteryData, masterySmall } from './fixtures';
import {
  LEVEL_LABEL,
  levelOf,
  masteryFromHub,
  masteryPips,
  masteryWord,
  sanitize,
  squadVisible,
  weakestChapters,
} from './model';

afterEach(cleanup);

const ch = (n: number, box: number): MasteryChapter => ({
  slot: `chapter-${n}`,
  instance: `ch${n}`,
  title: `Chapter ${n}`,
  box,
  n,
  open: true,
});
const chapters = [ch(1, 0), ch(2, 1), ch(3, 3), ch(4, 5)];
const base = { open: true, onClose: () => {}, chapters, status: 'ready' as const };

describe('mastery mapping', () => {
  it('covers every state with a word and 0-5 pips', () => {
    expect([0, 1, 2, 3, 4, 5].map((b) => [levelOf(b), masteryWord(b), masteryPips(b)])).toEqual([
      ['none', 'Not started', 0],
      ['learning', 'Learning', 1],
      ['learning', 'Learning', 2],
      ['getting', 'Getting there', 3],
      ['solid', 'Solid', 4],
      ['solid', 'Solid', 5],
    ]);
    expect(Object.values(LEVEL_LABEL)).toEqual([
      'Not started',
      'Learning',
      'Getting there',
      'Solid',
    ]);
  });
  it('hides squad data below three members, even if the server sent it', () => {
    expect(squadVisible(masteryData)).toBe(true);
    expect(squadVisible(masterySmall)).toBe(false);
    expect(JSON.stringify(sanitize({ ...masteryData, memberCount: 2 }))).not.toContain('squadAvg');
    const hub = masteryFromHub({ courseId: 'c', concepts: ['a'], mine: [0.4], squadAvg: null })!;
    expect(squadVisible(hub)).toBe(false);
  });
  it('weakest chapters never include Solid ones and go lowest first', () => {
    expect(weakestChapters(chapters).map((c) => c.n)).toEqual([1, 2, 3]);
  });
});

describe('MasteryPanel', () => {
  it('lists every chapter with a word and a reason, in an accessible dialog', () => {
    render(<MasteryPanel {...base} detail={masteryData} />);
    const dlg = screen.getByRole('dialog', { name: 'Mastery board' });
    expect(within(dlg).getAllByTestId('mastery-chapter')).toHaveLength(4);
    expect(within(dlg).getAllByText('Getting there').length).toBeGreaterThan(0);
    expect(within(dlg).getAllByRole('img', { name: /pips/ }).length).toBeGreaterThan(3);
  });
  it('shows no numeric grade, percent or points anywhere', () => {
    const { container } = render(<MasteryPanel {...base} detail={masteryData} />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\d+\s*%|\bxp\b|\bpoints?\b|\bscore\b|\bstreak\b|\bbadge\b|\brank/i);
    // the only digits are chapter numbers and the course code
    expect(text.replace(/chapter \d/gi, '').replace('BIO 201', '')).not.toMatch(/\d/);
  });
  it('shows the squad column with three or more, a note and no column below that', () => {
    const { unmount } = render(<MasteryPanel {...base} detail={masteryData} />);
    expect(screen.getByRole('columnheader', { name: 'Squad average' })).toBeTruthy();
    unmount();
    render(<MasteryPanel {...base} detail={masterySmall} />);
    expect(screen.queryByRole('columnheader', { name: 'Squad average' })).toBeNull();
    expect(screen.getByRole('note').textContent).toContain(
      'Squad averages appear once three or more people have joined',
    );
  });
  it('Practise this sends the chat phrase and closes', () => {
    const onPractise = vi.fn();
    const onClose = vi.fn();
    render(<MasteryPanel {...base} onClose={onClose} onPractise={onPractise} />);
    fireEvent.click(screen.getByRole('button', { name: 'Practise this: Chapter 1' }));
    expect(onPractise).toHaveBeenCalledWith('@cubbie quiz me on chapter 1');
    expect(onClose).toHaveBeenCalled();
  });
  it('offers Copy instead of sending when there is no chat (replay)', () => {
    render(<MasteryPanel {...base} />);
    expect(
      screen.getAllByRole('button', { name: /Practise this: Chapter/ })[0]!.textContent,
    ).toContain('Copy phrase');
  });
  it('Esc closes it and the empty state says what to do', () => {
    const onClose = vi.fn();
    render(<MasteryPanel {...base} chapters={[]} onClose={onClose} />);
    expect(screen.getByText(/No chapters yet/)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('shows an honest error without hiding the chapters', () => {
    const onRetry = vi.fn();
    render(<MasteryPanel {...base} status="error" onRetry={onRetry} />);
    expect(screen.getAllByTestId('mastery-chapter')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('MasterySummary and layer', () => {
  it('summary is word, pips and a reason', () => {
    render(<MasterySummary chapter={ch(5, 3)} />);
    expect(screen.getByText('Getting there')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /Your mastery: Getting there, 3 of 5 pips/ }),
    ).toBeTruthy();
  });
  it('opens on the world event and shows live chapters from the snapshot', async () => {
    publishMastery({ chapters });
    render(<MasteryLayer hub={null} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      globalThis.dispatchEvent(new Event('squad:mastery-open'));
    });
    expect(screen.getByRole('dialog', { name: 'Mastery board' })).toBeTruthy();
    expect(screen.getAllByTestId('mastery-chapter')).toHaveLength(4);
    await act(async () => publishMastery({ chapters: [ch(1, 5)] }));
    expect(screen.getAllByTestId('mastery-chapter')).toHaveLength(1);
  });
  it('opens at once with initialOpen (?mastery=1)', () => {
    publishMastery({ chapters });
    render(<MasteryLayer hub={null} initialOpen />);
    expect(screen.getByRole('dialog', { name: 'Mastery board' })).toBeTruthy();
  });
});
