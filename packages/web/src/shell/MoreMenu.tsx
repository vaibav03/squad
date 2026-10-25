import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../primitives/Icon';
import type { NavItem } from './types';

/**
 * Desktop "More" disclosure: a real button (aria-expanded, aria-controls) that opens a list of links.
 * Escape closes and returns focus to the button; arrow keys move between links; a click outside closes.
 */
export function MoreMenu({
  items,
  active,
  renderItem,
}: {
  items: NavItem[];
  active: boolean;
  renderItem: (n: NavItem, close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const links = () => [
    ...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"], a') ?? []),
  ];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
      const l = links();
      const i = l.indexOf(document.activeElement as HTMLElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % l.length : (i - 1 + l.length) % l.length;
      l[n]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && !open && document.activeElement === btn.current) {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => links()[0]?.focus());
    }
  };

  return (
    <div className="sq-shell__more" ref={box} onKeyDown={onKeyDown}>
      <button
        ref={btn}
        type="button"
        className={`sq-shell__navlink sq-shell__morebtn${active ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="menu" size={18} />
        <span>More</span>
      </button>
      {open ? (
        <ul id={listId} className="sq-shell__morepop">
          {items.map((n) => (
            <li key={n.key}>{renderItem(n, () => setOpen(false))}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
