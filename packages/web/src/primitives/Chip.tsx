import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import './chip.css';

export type Tone = 'neutral' | 'ok' | 'alert' | 'ember' | 'violet';

export interface ChipProps {
  tone?: Tone;
  selected?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Chip({ tone = 'neutral', selected, onSelect, onRemove, icon, disabled, className, children }: ChipProps) {
  const cls = ['sq-chip', `sq-chip--${tone}`, selected && 'is-selected', onSelect && 'is-interactive', className].filter(Boolean).join(' ');
  const body = (
    <>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="sq-chip__text">{children}</span>
    </>
  );
  return (
    <span className={cls}>
      {onSelect ? (
        <button type="button" className="sq-chip__main" aria-pressed={selected} onClick={onSelect} disabled={disabled}>
          {body}
        </button>
      ) : (
        <span className="sq-chip__main">{body}</span>
      )}
      {onRemove ? (
        <button type="button" className="sq-chip__remove" onClick={onRemove} disabled={disabled} aria-label="Remove">
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </span>
  );
}
