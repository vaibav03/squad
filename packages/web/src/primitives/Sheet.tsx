import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FocusTrap } from './FocusTrap';
import { IconButton } from './IconButton';
import './sheet.css';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: 'bottom' | 'right' | 'center';
  initialFocusRef?: RefObject<HTMLElement | null>;
  dismissible?: boolean;
  /** Always-night surface (over the canvas). */
  scene?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}

const EXIT_MS = 200;

export function Sheet({
  open,
  onClose,
  title,
  description,
  side = 'bottom',
  initialFocusRef,
  dismissible = true,
  scene,
  children,
  footer,
}: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, dismissible]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={`sq-sheet sq-sheet--${side}${scene ? ' sq-scene' : ''}`}
      data-state={shown ? 'open' : 'closed'}
    >
      <div
        className="sq-sheet__scrim"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <FocusTrap className="sq-sheet__trap" active={open} initialFocusRef={initialFocusRef}>
        <div
          className="sq-sheet__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
        >
          {side === 'bottom' ? <span className="sq-sheet__handle" aria-hidden="true" /> : null}
          <header className="sq-sheet__header">
            <h2 id={titleId} className="sq-sheet__title">
              {title}
            </h2>
            {dismissible ? <IconButton label="Close" icon="x" onClick={onClose} /> : null}
          </header>
          {description ? (
            <p id={descId} className="sq-sheet__desc">
              {description}
            </p>
          ) : null}
          <div className="sq-sheet__content">{children}</div>
          {footer ? <footer className="sq-sheet__footer">{footer}</footer> : null}
        </div>
      </FocusTrap>
    </div>,
    document.body,
  );
}

export function Modal(props: Omit<SheetProps, 'side'>) {
  return <Sheet {...props} side="center" />;
}
