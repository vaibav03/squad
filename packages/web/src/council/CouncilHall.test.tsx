// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createRoomSession, publishRoomSession } from '@squad/village/rooms';
import { CouncilHall } from './CouncilHall';

afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>).__squadRoomSession;
  window.history.replaceState(null, '', '/');
});
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
});

const hub = { hubUrl: 'http://hub.test', token: 't' };
const dialog = () => screen.queryByRole('dialog', { name: 'Ask the council' });

describe('CouncilHall', () => {
  it('renders nothing until the viewer is in the Council Hall', () => {
    render(<CouncilHall hub={hub} />);
    expect(dialog()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask the council' })).toBeNull();
  });

  it('walking in shows only the launch button; the council event opens it; walking out closes it', async () => {
    render(<CouncilHall hub={hub} />);
    const session = createRoomSession();
    act(() => publishRoomSession(session));
    act(() => session.enter('council-hall'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ask the council' })).toBeTruthy(),
    );
    expect(dialog()).toBeNull();
    act(() => void window.dispatchEvent(new Event('squad:council-open')));
    await waitFor(() => expect(dialog()).toBeTruthy());
    act(() => session.leave());
    await waitFor(() => expect(dialog()).toBeNull(), { timeout: 1500 });
  });

  it('a room that is not the hall does not open it', () => {
    const session = createRoomSession();
    publishRoomSession(session);
    render(<CouncilHall hub={hub} />);
    act(() => session.enter('debate-stage'));
    expect(dialog()).toBeNull();
  });

  it('after Esc the small "Ask the council" button brings the panel back', async () => {
    const session = createRoomSession();
    publishRoomSession(session);
    session.enter('council-hall');
    render(<CouncilHall hub={hub} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask the council' }));
    await waitFor(() => expect(dialog()).toBeTruthy());
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    await waitFor(() => expect(dialog()).toBeNull(), { timeout: 1500 });
    const launch = screen.getByRole('button', { name: 'Ask the council' });
    expect(launch.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(launch);
    await waitFor(() => expect(dialog()).toBeTruthy());
  });

  it('?council=1 opens it anywhere', async () => {
    window.history.replaceState(null, '', '/?council=1');
    render(<CouncilHall hub={hub} />);
    await waitFor(() => expect(dialog()).toBeTruthy());
  });

  it('?council=fixture plays a scripted run with no backend', async () => {
    window.history.replaceState(null, '', '/?council=fixture&state=refused');
    render(<CouncilHall hub={null} />);
    const box = await screen.findByRole('textbox', { name: 'Ask the council' });
    fireEvent.change(box, { target: { value: 'Give me the answers' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/does not answer questions about live exams/)).toBeTruthy();
  });
});
