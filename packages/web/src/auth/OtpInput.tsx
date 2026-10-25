import { useEffect, useId, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import './auth.css';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires once when the last digit lands (typed, pasted or autofilled). */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
  describedBy?: string;
}

const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Six numeric boxes with real one-time-code autofill, paste, arrows and backspace. */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  disabled,
  invalid,
  autoFocus,
  label = 'Verification code',
  describedBy,
}: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const groupId = useId();
  const chars = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // only on mount
  }, []);

  const focusAt = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  };

  const commit = (next: string, focusIndex: number) => {
    const v = next.slice(0, length);
    onChange(v);
    if (v.length === length && v !== value) onComplete?.(v);
    focusAt(focusIndex);
  };

  const fill = (from: number, incoming: string) => {
    const d = digitsOf(incoming);
    if (!d) return;
    const head = value.slice(0, from);
    const next = (head + d).slice(0, length);
    commit(next, Math.min(next.length, length - 1));
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (chars[i]) commit(value.slice(0, i) + value.slice(i + 1), i);
      else if (i > 0) commit(value.slice(0, i - 1) + value.slice(i), i - 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(length - 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!digitsOf(text)) return;
    e.preventDefault();
    // a pasted full code always replaces the whole field
    fill(digitsOf(text).length >= length ? 0 : i, text);
  };

  return (
    <div
      className={`sq-otp${invalid ? ' is-invalid' : ''}`}
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
    >
      {chars.map((c, i) => (
        <input
          key={`${groupId}-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="sq-otp__box"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? length : 2}
          aria-label={`${label}, digit ${i + 1} of ${length}`}
          aria-invalid={invalid ? true : undefined}
          value={c}
          disabled={disabled}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const d = digitsOf(e.target.value);
            if (!d) {
              if (chars[i]) commit(value.slice(0, i) + value.slice(i + 1), i);
              return;
            }
            if (d.length > 1) return fill(d.length >= length ? 0 : i, d);
            const at = Math.min(i, value.length);
            commit(value.slice(0, at) + d + value.slice(at + 1), Math.min(at + 1, length - 1));
          }}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={(e) => onPaste(i, e)}
        />
      ))}
    </div>
  );
}
