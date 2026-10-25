import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../primitives/Icon';
import { FLOWS, type PlanKind } from './registry';
import './plans.css';

/** Composer '+' button with a real menu (button + role=menu): Enter/Space/ArrowDown open, arrows move, Esc closes and refocuses. */
export function PlusMenu({
  onPick,
  onLedger,
  disabled,
}: {
  onPick: (k: PlanKind) => void;
  /** Group chats: open the group activity and ledger drawer (view=ledger). */
  onLedger?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const kinds: (PlanKind | 'ledger')[] = onLedger ? ['trip', 'study', 'ledger'] : ['trip', 'study'];

  useEffect(() => {
    if (open) items.current[0]?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`[data-plusmenu="${id}"]`)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, id]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const move = (from: number, d: number) =>
    items.current[(from + d + kinds.length) % kinds.length]?.focus();

  return (
    <span data-plusmenu={id} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={btn}
        type="button"
        className="sqc-iconbtn"
        aria-label="Plan together"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        data-testid="composer-plus"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="plus" size={20} />
      </button>
      {open ? (
        <div
          id={`${id}-menu`}
          role="menu"
          aria-label="Plan together"
          className="sqc-plusmenu"
          onKeyDown={(e) => {
            const i = items.current.findIndex((x) => x === document.activeElement);
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              move(i, -1);
            } else if (e.key === 'Tab') setOpen(false);
          }}
        >
          {kinds.map((k, i) => (
            <button
              key={k}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-testid={`plus-${k}`}
              onClick={() => {
                setOpen(false);
                if (k === 'ledger') onLedger?.();
                else onPick(k);
              }}
            >
              <Icon name={k === 'trip' ? 'plane' : k === 'study' ? 'book' : 'ledger'} size={16} />
              {k === 'ledger' ? 'Group activity & ledger' : FLOWS[k].action}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
