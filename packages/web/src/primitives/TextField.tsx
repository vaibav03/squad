import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon } from './Icon';
import './text-field.css';

type Native = Omit<
  InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value' | 'prefix'
>;
export interface TextFieldProps extends Native {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  multiline?: boolean;
  rows?: number;
}

export const TextField = forwardRef<HTMLInputElement | HTMLTextAreaElement, TextFieldProps>(
  function TextField(
    {
      label,
      value,
      onChange,
      hint,
      error,
      prefix,
      suffix,
      multiline,
      rows = 3,
      className,
      id: idProp,
      required,
      disabled,
      ...rest
    },
    ref,
  ) {
    const auto = useId();
    const id = idProp ?? auto;
    const describedBy =
      [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') ||
      undefined;
    const common = {
      id,
      value,
      required,
      disabled,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy,
      className: 'sq-field__input',
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      ...rest,
    };
    return (
      <div
        className={['sq-field', error && 'has-error', disabled && 'is-disabled', className]
          .filter(Boolean)
          .join(' ')}
      >
        <label className="sq-field__label" htmlFor={id}>
          {label}
          {required ? (
            <span className="sq-field__req" aria-hidden="true">
              {' '}
              *
            </span>
          ) : null}
        </label>
        <div className="sq-field__control">
          {prefix ? <span className="sq-field__affix">{prefix}</span> : null}
          {multiline ? (
            <textarea
              ref={ref as React.Ref<HTMLTextAreaElement>}
              rows={rows}
              {...(common as TextareaHTMLAttributes<HTMLTextAreaElement>)}
            />
          ) : (
            <input
              ref={ref as React.Ref<HTMLInputElement>}
              {...(common as InputHTMLAttributes<HTMLInputElement>)}
            />
          )}
          {suffix ? <span className="sq-field__affix">{suffix}</span> : null}
        </div>
        {error ? (
          <p className="sq-field__error" id={`${id}-err`}>
            <Icon name="alert" size={14} />
            {error}
          </p>
        ) : null}
        {hint ? (
          <p className="sq-field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
