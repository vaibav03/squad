// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Markdown } from './Markdown';
import { Sheet } from './Sheet';
import { StatusDot } from './StatusDot';
import { Tabs } from './Tabs';
import { TextField } from './TextField';

afterEach(cleanup);

describe('primitives', () => {
  it('Button loading blocks clicks and sets aria-busy', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole('button');
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    expect(b.getAttribute('aria-busy')).toBe('true');
  });
  it('StatusDot always renders a text cue', () => {
    render(<StatusDot status="offline" />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });
  it('Tabs move with arrow keys and Home/End', () => {
    const onChange = vi.fn();
    render(
      <Tabs
        value="a"
        onValueChange={onChange}
        items={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'A' }), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
  });
  it('TextField wires errors to aria', () => {
    render(<TextField label="Phone" value="1" onChange={() => {}} error="Too short" />);
    const input = screen.getByLabelText('Phone');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent,
    ).toContain('Too short');
  });
  it('Markdown never creates unsafe links or raw HTML', () => {
    const { container } = render(
      <Markdown>
        {
          '[x](javascript:alert(1)) <img src=x onerror=alert(1)> [ok](https://a.dev) [cite: ch5 p.12]'
        }
      </Markdown>,
    );
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href="https://a.dev"]')?.getAttribute('rel')).toContain(
      'noopener',
    );
    expect(container.querySelector('.sq-md__cite')?.textContent).toBe('ch5 p.12');
  });
  it('Sheet closes on Escape and exposes a labelled dialog', () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} title="Discard?">
        <button>Inside</button>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Discard?' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
