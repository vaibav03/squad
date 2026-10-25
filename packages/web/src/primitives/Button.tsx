import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import { Spinner } from './Spinner';
import './button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconStart?: IconName;
  iconEnd?: IconName;
  fullWidth?: boolean;
  children?: ReactNode;
}
export type ButtonProps = BaseProps &
  (
    | ({ as?: 'button' } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps>)
    | ({ as: 'a' } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps>)
  );

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(props, ref) {
    const {
      variant = 'secondary',
      size = 'md',
      loading,
      iconStart,
      iconEnd,
      fullWidth,
      children,
      className,
      ...rest
    } = props;
    const cls = [
      'sq-btn',
      `sq-btn--${variant}`,
      `sq-btn--${size}`,
      fullWidth && 'sq-btn--full',
      loading && 'is-loading',
      className,
    ]
      .filter(Boolean)
      .join(' ');
    const inner = (
      <>
        <span className="sq-btn__icon" aria-hidden={loading ? undefined : true}>
          {loading ? (
            <Spinner size={14} label="Loading" />
          ) : iconStart ? (
            <Icon name={iconStart} size={18} />
          ) : null}
        </span>
        <span className="sq-btn__label">{children}</span>
        {iconEnd ? <Icon name={iconEnd} size={18} className="sq-btn__end" /> : null}
      </>
    );
    if (props.as === 'a') {
      const {
        as: _as,
        loading: _l,
        ...anchor
      } = rest as AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; loading?: boolean };
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={cls}
          {...anchor}
          aria-busy={loading || undefined}
        >
          {inner}
        </a>
      );
    }
    const {
      as: _as,
      disabled,
      onClick,
      type = 'button',
      ...btn
    } = rest as ButtonHTMLAttributes<HTMLButtonElement> & { as?: string };
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type}
        className={cls}
        disabled={disabled}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        onClick={loading ? (e) => e.preventDefault() : onClick}
        {...btn}
      >
        {inner}
      </button>
    );
  },
);
