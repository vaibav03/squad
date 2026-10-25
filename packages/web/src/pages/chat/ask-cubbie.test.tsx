// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatContextRef } from '@squad/core';
import { Composer } from './Composer';
import type { ChatApi } from './api';
import { queueAskCubbie, takePendingAsk } from './ask-cubbie';

afterEach(cleanup);
beforeEach(() => sessionStorage.clear());

const ref: ChatContextRef = {
  sourceId: 'src1',
  kind: 'canvas_assignment',
  title: 'Essay 2',
  courseName: 'Statistics 101',
  eventLabel: 'Due Fri, Nov 6',
  location: { label: 'item c1' },
  provenance: 'fixture',
  provider: 'canvas',
  shared: false,
};
const priv: ChatContextRef = { ...ref, title: 'Private calendar event', courseName: undefined, eventLabel: null };
const api = (): ChatApi =>
  ({ contextRef: vi.fn(async () => ({ ref, groupView: priv })) }) as unknown as ChatApi;

describe('Ask Cubbie composer handoff', () => {
  it('shows a labelled removable chip, prefills the prompt and never auto-sends', async () => {
    queueAskCubbie({ chatId: 'dm:s_ana', sourceIds: [{ sourceId: 'src1' }] });
    const onSend = vi.fn();
    render(<Composer api={api()} chatKind="dm" chatId="dm:s_ana" onSend={onSend} />);
    const chip = await screen.findByTestId('composer-context-chip');
    expect(chip.textContent).toContain('Essay 2');
    expect(chip.textContent).toContain('Statistics 101');
    expect(screen.getByTestId('composer-context-provenance').textContent).toBe('Demo: Canvas');
    expect((screen.getByTestId('chat-composer-input') as HTMLTextAreaElement).value).toBe(
      '@cubbie what should I focus on for Essay 2?',
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(takePendingAsk('dm:s_ana')).toBeNull(); // cleared: a reload does not re-attach it
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]![0].context).toEqual([ref]);
  });

  it('removing the chip sends the message without context', async () => {
    queueAskCubbie({ chatId: 'dm:s_ana', sourceIds: [{ sourceId: 'src1' }], prefill: '@cubbie hi' });
    const onSend = vi.fn();
    render(<Composer api={api()} chatKind="dm" chatId="dm:s_ana" onSend={onSend} />);
    await screen.findByTestId('composer-context-chip');
    fireEvent.click(screen.getByTestId('composer-context-chip-remove'));
    expect(screen.queryByTestId('composer-context-chip')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend.mock.calls[0]![0].context).toBeUndefined();
    expect(onSend.mock.calls[0]![0].text).toBe('@cubbie hi');
  });

  it('a group composer shows only the group-safe view (no private event title)', async () => {
    queueAskCubbie({ chatId: 'group:sq', sourceIds: [{ sourceId: 'src1' }] });
    render(<Composer api={api()} chatKind="group" chatId="group:sq" onSend={vi.fn()} />);
    const chip = await screen.findByTestId('composer-context-chip');
    expect(chip.textContent).toContain('Private calendar event');
  });

  it('does not touch a queued ask meant for another chat', async () => {
    queueAskCubbie({ chatId: 'group:sq', sourceIds: [{ sourceId: 'src1' }] });
    render(<Composer api={api()} chatKind="dm" chatId="dm:s_ana" onSend={vi.fn()} />);
    expect(screen.queryByTestId('composer-context-chip')).toBeNull();
    expect(takePendingAsk('group:sq')).not.toBeNull();
  });
});
