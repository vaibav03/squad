import { applySuggestion, mentionSuggestions } from './model';

export interface MentionAutocompleteProps {
  text: string;
  caret: number;
  /** Highlighted row (controlled, so the composer's key handler owns arrows). Default 0. */
  index?: number;
  onSelect(next: { text: string; caret: number }): void;
  onIndexChange?(i: number): void;
  /** Gives the list `id={idPrefix}` and each option `id={idPrefix}-{alias}` (for aria-activedescendant). */
  idPrefix?: string;
}

/**
 * A standalone @-mention popup. Integration point for the chat composer (not wired yet, see docs/agent-aliases.md):
 * render `<MentionAutocomplete text caret onSelect />` above the textarea and call `mentionKey(e.key, ...)` from onKeyDown.
 * Renders nothing unless the caret is inside an `@word`. Cubbie is always the first row for `@`, `@cub` and `@cubbi`.
 */
export function MentionAutocomplete(p: MentionAutocompleteProps) {
  const items = mentionSuggestions(p.text, p.caret);
  if (items.length === 0) return null;
  const idx = Math.min(p.index ?? 0, items.length - 1);
  return (
    <ul
      role="listbox"
      aria-label="Tag an agent"
      className="mention-ac sqc-mentions"
      {...(p.idPrefix ? { id: p.idPrefix } : {})}
    >
      {items.map((s, i) => (
        <li
          key={s.alias}
          {...(p.idPrefix ? { id: `${p.idPrefix}-${s.alias}` } : {})}
          data-testid={`chat-mention-${s.alias}`}
          className="sqc-mention"
          role="option"
          aria-selected={i === idx}
          data-alias={s.alias}
          onMouseEnter={() => p.onIndexChange?.(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus in the textarea
            p.onSelect(applySuggestion(p.text, p.caret, s.alias));
          }}
        >
          <span className="sqc-mention__name">@{s.alias}</span>
          <span className="sqc-mention__hint">{s.agent.description}</span>
        </li>
      ))}
    </ul>
  );
}

/** Keyboard helper for the composer: returns what to do with a key while the popup is open (or null to ignore). */
export function mentionKey(
  key: string,
  text: string,
  caret: number,
  index: number,
):
  | { kind: 'move'; index: number }
  | { kind: 'select'; next: { text: string; caret: number } }
  | { kind: 'close' }
  | null {
  const items = mentionSuggestions(text, caret);
  if (items.length === 0) return null;
  if (key === 'ArrowDown') return { kind: 'move', index: (index + 1) % items.length };
  if (key === 'ArrowUp') return { kind: 'move', index: (index - 1 + items.length) % items.length };
  if (key === 'Escape') return { kind: 'close' };
  if (key === 'Enter' || key === 'Tab') {
    const s = items[Math.min(index, items.length - 1)]!;
    return { kind: 'select', next: applySuggestion(text, caret, s.alias) };
  }
  return null;
}
