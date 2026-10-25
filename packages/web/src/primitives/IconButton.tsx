import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import type { ButtonSize, ButtonVariant } from './Button';
import './icon-button.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required accessible name. */
  label: string;
  icon: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', pressed, className, type = 'button', ...rest },
  ref,
) {
  const cls = ['sq-iconbtn', `sq-iconbtn--${variant}`, `sq-iconbtn--${size}`, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : size === 'lg' ? 24 : 20} />
    </button>
  );
});
