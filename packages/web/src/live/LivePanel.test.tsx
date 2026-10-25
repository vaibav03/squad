// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const openSource = vi.fn();
vi.mock('../components/source-viewer', () => ({ openSource: (c: unknown) => openSource(c) }));

import { LivePanel } from './LivePanel';
import { LiveChatCard } from './LiveChatCard';
import { mockLiveTransport, MOCK_ID } from './fixtures';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (n: number) => clearTimeout(n));
  openSource.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fast = () => mockLiveTransport({ wordMs: 0, gapMs: 0 });

describe('LivePanel (mock stream)', () => {
  it('plays the scripted discussion: demo tag, captions, transcript, takeaways, citation chip, ended', async () => {
    const AC = vi.fn();
    vi.stubGlobal('AudioContext', AC);
    render(
      <LivePanel
        hub={null}
        open
        topic="How do I split ch5 and ch6?"
        transport={fast()}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('Demo mode: scripted discussion')).toBeTruthy();
    expect(screen.getByText('AI-generated discussion')).toBeTruthy();
    // finishes: Ended + Replay
    await screen.findByText(/Ended\./, undefined, { timeout: 5000 });
    const tx = screen.getByRole('list', { name: 'Transcript' });
    expect(within(tx).getAllByText(/Chair|Tutor/).length).toBeGreaterThan(0);
    // takeaways built
    const decisions = screen.getByRole('region', { name: 'Decisions' });
    expect(within(decisions).getByText(/One evening on ch5/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Open disagreements' })).toBeTruthy();
    expect(screen.getByText(/Grounded in your course material/)).toBeTruthy();
    // citation chip opens the source viewer with the verified quote
    fireEvent.click(within(tx).getAllByRole('button', { name: /Open source ch5\.pdf p\.7/ })[0]!);
    expect(openSource).toHaveBeenCalledWith(
      expect.objectContaining({
        file: 'ch5.pdf',
        page: 7,
        quote: expect.stringContaining('Conditioning'),
      }),
    );
    // jump to turn focuses the transcript turn
    fireEvent.click(within(decisions).getByRole('button', { name: 'Jump to turn' }));
    // captions-only mode (default mode for entry-less topic): no AudioContext
    expect(AC).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Replay with captions/ })).toBeTruthy();
  });

  it('interruption yields the current speaker and the table answers', async () => {
    const tr = mockLiveTransport({ wordMs: 5, gapMs: 5 });
    render(<LivePanel hub={null} open topic="topic here" transport={tr} onClose={() => {}} />);
    await screen.findByText(/Welcome\./i, undefined, { timeout: 3000 }).catch(() => undefined);
    const box = await screen.findByRole('textbox', { name: 'Say something to the table' });
    await waitFor(() => expect((box as HTMLInputElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.change(box, { target: { value: 'wait, what about ch4?' } });
      fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    });
    const tx = screen.getByRole('list', { name: 'Transcript' });
    await waitFor(() => expect(within(tx).getByText('wait, what about ch4?')).toBeTruthy());
    await waitFor(() => expect(within(tx).getAllByText('yielded').length).toBeGreaterThan(0));
  });

  it('entry form: suggestions, captions-only choice, one-time mic note, starts the room', async () => {
    const AC = vi.fn();
    vi.stubGlobal('AudioContext', AC);
    render(<LivePanel hub={null} open transport={fast()} onClose={() => {}} />);
    expect(screen.getByRole('radio', { name: /Audio/ })).toBeTruthy();
    expect(screen.getByText(/only that text is sent/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use text instead' }));
    expect((screen.getByRole('radio', { name: /Captions only/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Should I switch my major?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start the discussion' }));
    expect(await screen.findByText('Demo mode: scripted discussion')).toBeTruthy();
    expect(screen.getByText(/Captions only\. Nothing will play/)).toBeTruthy();
    expect(AC).not.toHaveBeenCalled();
  });

  it('has labelled controls, a labelled table, caption size radios and mute', async () => {
    render(<LivePanel hub={null} open topic="topic here" transport={fast()} onClose={() => {}} />);
    await screen
      .findByRole('group', { name: 'Join the discussion' }, { timeout: 3000 })
      .catch(() => undefined);
    expect(screen.getByRole('radiogroup', { name: 'Caption size' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'The table' })).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /Has the floor|Tutor|Chair/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Leave/ })).toBeTruthy();
  });

  it('calm mode marks the room reduced', async () => {
    const { container } = render(
      <LivePanel hub={null} open calm topic="topic here" transport={fast()} onClose={() => {}} />,
    );
    await screen.findByText('Demo mode: scripted discussion');
    expect(container.ownerDocument.querySelector('.ld-root[data-reduced="true"]')).toBeTruthy();
  });

  it('model unavailable shows an honest message with a fix hint and retry', async () => {
    const tr = { ...fast(), start: async () => Promise.reject(new Error('x')) };
    render(<LivePanel hub={null} open topic="topic here" transport={tr} onClose={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Fix:/);
    expect(within(alert).getByRole('button', { name: /Try again/ })).toBeTruthy();
  });
});

describe('LiveChatCard', () => {
  it('summarises takeaways, labels demo, and opens the discussion read-only', async () => {
    render(<LiveChatCard hub={null} liveId={MOCK_ID} />);
    const card = await screen.findByTestId('live-card');
    expect(within(card).getByText('Demo mode')).toBeTruthy();
    expect(within(card).getByText(/decision/)).toBeTruthy();
    expect(within(card).getByText(/Grounded in your course material/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Open discussion' }));
    expect(await screen.findByText('Replay')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Replay with captions/ })).toBeTruthy();
  });
});
