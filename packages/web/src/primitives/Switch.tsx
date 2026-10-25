import { useId } from 'react';
import './switch.css';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  hideLabel,
  disabled,
  className,
}: SwitchProps) {
  const id = useId();
  return (
    <label
      className={['sq-switch', disabled && 'is-disabled', className].filter(Boolean).join(' ')}
      htmlFor={id}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="sq-switch__track"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="sq-switch__thumb" />
      </button>
      <span className={hideLabel ? 'sq-sr-only' : 'sq-switch__label'}>{label}</span>
    </label>
  );
}
