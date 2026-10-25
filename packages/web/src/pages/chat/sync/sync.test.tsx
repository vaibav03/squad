// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DeliveryState } from '@squad/core';
import { SyncBadge } from './SyncBadge';
import { applySyncPatch, retryImessage } from './applySyncPatch';

afterEach(cleanup);
const ds = (state: DeliveryState['state'], label: string): DeliveryState => ({
  state,
  label,
  updatedAt: 1,
});

describe('SyncBadge', () => {
  it('renders nothing when there is nothing to show', () => {
    const { container } = render(<SyncBadge transport="web" />);
    expect(container.firstChild).toBeNull();
  });
  it('shows via iMessage and sender label', () => {
    render(<SyncBadge transport="imessage" senderLabel="•••• 4567" />);
    expect(screen.getByText('via iMessage')).toBeTruthy();
    expect(screen.getByText('•••• 4567')).toBeTruthy();
  });
  it.each([
    ['queued', 'Sending to iMessage'],
    ['sent', 'Sent to iMessage'],
    ['delivered', 'Delivered'],
    ['dry_run', 'Dry run, not sent'],
    ['web_only', 'Web only, not sent to iMessage'],
  ] as const)('shows the %s label', (state, label) => {
    render(<SyncBadge deliveryState={ds(state, label)} onRetry={() => {}} />);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
  it('failed offers Retry', () => {
    const onRetry = vi.fn();
    render(<SyncBadge deliveryState={ds('failed', 'Failed: transport error')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
  it('shows honest placeholders without file names', () => {
    render(
      <SyncBadge
        skippedAttachments={[
          { mime: 'video/mp4', name: '/Users/x/secret.mov', reason: 'too_large' },
          { mime: 'image/heic', reason: 'unsupported_type' },
        ]}
        receivedLate
      />,
    );
    expect(screen.getByText('Attachment not shown: file is too large')).toBeTruthy();
    expect(screen.getByText('Attachment not shown: this file type is not supported')).toBeTruthy();
    expect(screen.getByRole('status').textContent).not.toContain('secret');
    expect(screen.getByText('arrived late')).toBeTruthy();
  });
});

describe('applySyncPatch', () => {
  const msgs = [
    { id: 'a', text: 'x' },
    { id: 'b', text: 'y' },
  ];
  it('patches immutably', () => {
    const out = applySyncPatch(msgs, 'b', { receivedLate: true });
    expect(out[1]).toEqual({ id: 'b', text: 'y', receivedLate: true });
    expect(out[0]).toBe(msgs[0]);
    expect(msgs[1]).toEqual({ id: 'b', text: 'y' });
  });
  it('is a no-op for an unknown id', () => {
    expect(applySyncPatch(msgs, 'zz', { receivedLate: true })).toBe(msgs);
  });
});

describe('retryImessage', () => {
  it('POSTs with bearer auth', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ retried: 1 }), { status: 200 }));
    const r = await retryImessage('http://hub/', 'tok', 'm 1', f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, retried: 1 });
    expect(f).toHaveBeenCalledWith('http://hub/v1/imessage/messages/m%201/retry', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    });
  });
  it('reports failure', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 500 }));
    expect(await retryImessage('http://hub', 't', 'm', f as unknown as typeof fetch)).toEqual({
      ok: false,
      retried: 0,
    });
  });
});
