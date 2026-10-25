import { useId, type ReactNode } from 'react';
import './radio-cards.css';

export interface RadioCardOption {
  value: string;
  label: string;
  description?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
}
export interface RadioCardsProps {
  value: string;
  onValueChange: (v: string) => void;
  options: RadioCardOption[];
  name?: string;
  legend: string;
  hideLegend?: boolean;
  columns?: 1 | 2;
  className?: string;
}

/** A real radio group (native inputs) styled as cards. Trailing slot sits outside the label so it can hold a play button. */
export function RadioCards({
  value,
  onValueChange,
  options,
  name,
  legend,
  hideLegend,
  columns = 1,
  className,
}: RadioCardsProps) {
  const auto = useId();
  const group = name ?? auto;
  return (
    <fieldset
      className={['sq-radios', `sq-radios--${columns}`, className].filter(Boolean).join(' ')}
    >
      <legend className={hideLegend ? 'sq-sr-only' : 'sq-radios__legend'}>{legend}</legend>
      {options.map((o) => {
        const id = `${group}-${o.value}`;
        const selected = o.value === value;
        return (
          <div
            key={o.value}
            className={['sq-radio', selected && 'is-selected', o.disabled && 'is-disabled']
              .filter(Boolean)
              .join(' ')}
          >
            <input
              id={id}
              className="sq-radio__input"
              type="radio"
              name={group}
              value={o.value}
              checked={selected}
              disabled={o.disabled}
              onChange={() => onValueChange(o.value)}
            />
            <label htmlFor={id} className="sq-radio__label">
              {o.leading ? <span className="sq-radio__leading">{o.leading}</span> : null}
              <span className="sq-radio__text">
                <span className="sq-radio__title">{o.label}</span>
                {o.description ? <span className="sq-radio__desc">{o.description}</span> : null}
              </span>
              <span className="sq-radio__dot" aria-hidden="true" />
            </label>
            {o.trailing ? <span className="sq-radio__trailing">{o.trailing}</span> : null}
          </div>
        );
      })}
    </fieldset>
  );
}
