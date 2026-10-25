import type { ReactNode } from 'react';
import './page.css';

export interface PageProps {
  title: string;
  eyebrow?: string;
  /** What this page is, in one plain sentence. */
  lede?: string;
  /** What happens next / what to do here, in one plain sentence (rendered as "Next: ..."). */
  next?: string;
  actions?: ReactNode;
  width?: 'narrow' | 'default' | 'wide';
  children?: ReactNode;
  className?: string;
}

export function Page({
  title,
  eyebrow,
  lede,
  next,
  actions,
  width = 'default',
  children,
  className,
}: PageProps) {
  return (
    <div className={['sq-page', `sq-page--${width}`, className].filter(Boolean).join(' ')}>
      <header className="sq-page__header">
        <div className="sq-page__heading">
          {eyebrow ? <p className="sq-page__eyebrow">{eyebrow}</p> : null}
          <h1 className="sq-page__title" tabIndex={-1} data-page-title>
            {title}
          </h1>
          {lede ? (
            <p className="sq-page__lede" data-testid="page-lede">
              {lede}
            </p>
          ) : null}
          {next ? (
            <p className="sq-page__next" data-testid="page-next">
              <strong>Next:</strong> {next}
            </p>
          ) : null}
        </div>
        {actions ? <div className="sq-page__actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function PageSection({
  title,
  description,
  children,
  actions,
}: {
  title?: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="sq-section">
      {title || actions ? (
        <div className="sq-section__head">
          <div>
            {title ? <h2 className="sq-section__title">{title}</h2> : null}
            {description ? <p className="sq-section__desc">{description}</p> : null}
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
