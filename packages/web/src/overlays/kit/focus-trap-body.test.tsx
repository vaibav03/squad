// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useFocusTrap } from './hooks';

function Trap({ onEscape }: { onEscape: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>({ active: true, onEscape });
  return (
    <div ref={ref} tabIndex={-1}>
      <button>one</button>
    </div>
  );
}

describe('useFocusTrap with focus lost to body', () => {
  afterEach(cleanup);
  it('still answers Escape (regression: council panel ignored Esc after a run disabled the textarea)', () => {
    const esc = vi.fn();
    render(<Trap onEscape={esc} />);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(esc).toHaveBeenCalledTimes(1);
  });
  it('does not double-fire when focus is inside', () => {
    const esc = vi.fn();
    const { getByText } = render(<Trap onEscape={esc} />);
    getByText('one').focus();
    getByText('one').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(esc).toHaveBeenCalledTimes(1);
  });
});

describe('useFocusTrap focus containment', () => {
  afterEach(cleanup);
  it('returns focus to the panel when it lands outside, and Esc still works', () => {
    const esc = vi.fn();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const { getByText } = render(<Trap onEscape={esc} />);
    outside.focus();
    expect(document.activeElement).not.toBe(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(esc).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});
