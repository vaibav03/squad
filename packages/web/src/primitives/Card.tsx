import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import './card.css';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'raised' | 'inset' | 'glass';
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: 'div' | 'section' | 'article' | 'li' | 'a' | 'button';
  href?: string;
  children?: ReactNode;
}

function CardRoot({ tone = 'default', interactive, padding = 'md', as = 'div', className, children, ...rest }: CardProps, ref: React.Ref<HTMLElement>) {
  const Tag = (interactive && as === 'div' ? 'button' : as) as 'div';
  const cls = ['sq-card', `sq-card--${tone}`, `sq-card--pad-${padding}`, interactive && 'is-interactive', className].filter(Boolean).join(' ');
  const extra = Tag === ('button' as string) ? { type: 'button' } : {};
  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={cls} {...extra} {...rest}>
      {children}
    </Tag>
  );
}

const Root = forwardRef(CardRoot);
Root.displayName = 'Card';

const Header = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={['sq-card__header', className].filter(Boolean).join(' ')} {...p} />;
const Body = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={['sq-card__body', className].filter(Boolean).join(' ')} {...p} />;
const Footer = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={['sq-card__footer', className].filter(Boolean).join(' ')} {...p} />;

export const Card = Object.assign(Root, { Header, Body, Footer });
