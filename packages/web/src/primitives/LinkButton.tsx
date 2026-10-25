import { Link, type LinkProps } from 'react-router-dom';
import { Icon } from './Icon';
import type { IconName } from './icon-names';
import type { ButtonSize, ButtonVariant } from './Button';

/** A router Link that looks like a Button, so a call to action navigates inside the app (back button, focus) instead of reloading. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  iconEnd,
  className,
  children,
  ...rest
}: Omit<LinkProps, 'className'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconEnd?: IconName;
  className?: string;
}) {
  return (
    <Link
      {...rest}
      className={['sq-btn', `sq-btn--${variant}`, `sq-btn--${size}`, className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="sq-btn__label">{children}</span>
      {iconEnd ? <Icon name={iconEnd} size={18} className="sq-btn__end" /> : null}
    </Link>
  );
}
