// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmMessageCard } from './cards';

afterEach(cleanup);
const base = {
  type: 'confirm' as const,
  taskId: 't1',
  question: 'Which side argued better?',
  options: ['For', 'Against'],
};
const reask = { chatId: 'group:sq_demo', text: '@cubbie debate: open book exams' };

describe('ConfirmMessageCard expiry', () => {
  it('a timed-out card disables options, says it expired and Ask again re-sends once', async () => {
    const onReask = vi.fn(async () => true);
    render(
      <ConfirmMessageCard
        card={{ ...base, status: 'timeout', reask }}
        onChoose={async () => 'ok'}
        onReask={onReask}
      />,
    );
    expect(screen.getByText('This question expired.')).toBeTruthy();
    expect((screen.getByTestId('chat-confirm-option-1') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('chat-confirm-option-2') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('chat-confirm-ask-again'));
    fireEvent.click(screen.getByTestId('chat-confirm-ask-again'));
    await waitFor(() => expect(screen.getByText(/Asked again/)).toBeTruthy());
    expect(onReask).toHaveBeenCalledTimes(1);
    // the old card stays disabled
    expect((screen.getByTestId('chat-confirm-option-1') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a pending card whose expiresAt is past is disabled with Ask again', () => {
    render(
      <ConfirmMessageCard
        card={{ ...base, status: 'pending', expiresAt: Date.now() - 1000, reask }}
        onChoose={async () => 'ok'}
        onReask={async () => true}
      />,
    );
    expect(screen.getByText('This question expired.')).toBeTruthy();
    expect((screen.getByTestId('chat-confirm-option-1') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('chat-confirm-ask-again')).toBeTruthy();
  });

  it('a stale (409) answer turns the card into the expired state instead of implying it went through', async () => {
    render(
      <ConfirmMessageCard
        card={{ ...base, status: 'pending', reask }}
        onChoose={async () => 'stale'}
        onReask={async () => true}
      />,
    );
    fireEvent.click(screen.getByTestId('chat-confirm-option-1'));
    await waitFor(() => expect(screen.getByText('This question expired.')).toBeTruthy());
    expect(screen.queryByText(/Answer sent/)).toBeNull();
    expect((screen.getByTestId('chat-confirm-option-2') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an answered card says Already answered with the chosen option and no Ask again', () => {
    render(
      <ConfirmMessageCard
        card={{ ...base, status: 'answered', answer: 'Against', reask }}
        onChoose={async () => 'ok'}
        onReask={async () => true}
      />,
    );
    expect(screen.getByText(/Already answered. You chose: Against/)).toBeTruthy();
    expect(screen.queryByTestId('chat-confirm-ask-again')).toBeNull();
    expect((screen.getByTestId('chat-confirm-option-1') as HTMLButtonElement).disabled).toBe(true);
  });
});
