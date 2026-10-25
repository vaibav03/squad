// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MentionAutocomplete, mentionKey } from './MentionAutocomplete';
import { activeMentionQuery, applySuggestion, mentionSuggestions } from './model';

afterEach(cleanup);

describe('activeMentionQuery', () => {
  it.each([
    ['@', 1, ''],
    ['hey @cub', 8, 'cub'],
    ['@cubbi', 6, 'cubbi'],
    ['ask @Tu', 7, 'Tu'],
  ])('%j at %i', (t, c, q) => expect(activeMentionQuery(t, c)?.query).toBe(q));
  it.each([
    ['hello', 5],
    ['me@cub', 6],
    ['@cubbie hi', 10],
    ['a/@cubbi', 8],
    ['@@cub', 5],
    ['', 0],
  ])('not typing a mention: %j at %i', (t, c) => expect(activeMentionQuery(t, c)).toBeNull());
});

describe('suggestions', () => {
  it('Nook first for @, @cub and @cubbi', () => {
    expect(mentionSuggestions('@', 1)[0]!.alias).toBe('squad');
    expect(mentionSuggestions('@cub', 4).map((s) => s.alias)).toEqual(['cubbie', 'cubbi']);
    expect(mentionSuggestions('@cubbi', 6).map((s) => s.alias)).toEqual(['cubbie', 'cubbi']);
    expect(mentionSuggestions('@cubbie', 7)[0]!.agent.name).toBe('Nook');
    expect(mentionSuggestions('@tu', 3)[0]!.alias).toBe('tutor');
  });
  it('applySuggestion replaces the typed word and moves the caret', () => {
    expect(applySuggestion('hey @cub', 8, 'cubbie')).toEqual({ text: 'hey @cubbie ', caret: 12 });
    expect(applySuggestion('@cub what is z', 4, 'cubbi')).toEqual({
      text: '@cubbi what is z',
      caret: 7,
    });
  });
});

describe('<MentionAutocomplete>', () => {
  it('renders nothing when not typing a mention', () => {
    const { container } = render(
      <MentionAutocomplete text="hello" caret={5} onSelect={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });
  it('lists Nook first and selects on click', () => {
    const onSelect = vi.fn();
    render(<MentionAutocomplete text="@cub" caret={4} onSelect={onSelect} />);
    const opts = screen.getAllByRole('option');
    expect(opts[0]!.getAttribute('data-alias')).toBe('cubbie');
    expect(opts[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.mouseDown(opts[1]!);
    expect(onSelect).toHaveBeenCalledWith({ text: '@cubbi ', caret: 7 });
  });
  it('mentionKey moves, selects and closes', () => {
    expect(mentionKey('ArrowDown', '@', 1, 0)).toEqual({ kind: 'move', index: 1 });
    expect(mentionKey('ArrowUp', '@', 1, 0)?.kind).toBe('move');
    expect(mentionKey('Enter', '@cub', 4, 0)).toEqual({
      kind: 'select',
      next: { text: '@cubbie ', caret: 8 },
    });
    expect(mentionKey('Escape', '@cub', 4, 0)).toEqual({ kind: 'close' });
    expect(mentionKey('a', '@cub', 4, 0)).toBeNull();
    expect(mentionKey('Enter', 'hello', 5, 0)).toBeNull();
  });
});
