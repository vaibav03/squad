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
    render(<Trap onEscape={esc} />);
    outside.focus();
    expect(document.activeElement).not.toBe(outside);
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(esc).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});

describe('nested focus traps (council board over the room panel)', () => {
  afterEach(cleanup);
  function Nested({ outerEsc, innerEsc }: { outerEsc: () => void; innerEsc: () => void }) {
    const outer = useFocusTrap<HTMLDivElement>({ active: true, onEscape: outerEsc });
    const inner = useFocusTrap<HTMLDivElement>({ active: true, onEscape: innerEsc });
    return (
      <>
        <div ref={outer} tabIndex={-1}>
          <button>outer</button>
        </div>
        <div ref={inner} tabIndex={-1}>
          <button>inner</button>
        </div>
      </>
    );
  }
  it('does not recurse forever when focus moves between them, and only the top trap answers Esc', () => {
    const outerEsc = vi.fn();
    const innerEsc = vi.fn();
    const { getByText } = render(<Nested outerEsc={outerEsc} innerEsc={innerEsc} />);
    // used to throw "Maximum call stack size exceeded" (each trap pulled focus back from the other)
    expect(() => getByText('outer').focus()).not.toThrow();
    expect(document.activeElement).toBe(getByText('inner').parentElement); // jsdom has no layout: the trap root
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(innerEsc).toHaveBeenCalledTimes(1);
    expect(outerEsc).not.toHaveBeenCalled();
  });
});
