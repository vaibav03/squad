import type { ReactNode } from 'react';
import './page.css';

export interface PageProps {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  width?: 'narrow' | 'default' | 'wide';
  children?: ReactNode;
  className?: string;
}

export function Page({ title, eyebrow, actions, width = 'default', children, className }: PageProps) {
  return (
    <div className={['sq-page', `sq-page--${width}`, className].filter(Boolean).join(' ')}>
      <header className="sq-page__header">
        <div className="sq-page__heading">
          {eyebrow ? <p className="sq-page__eyebrow">{eyebrow}</p> : null}
          <h1 className="sq-page__title" tabIndex={-1} data-page-title>{title}</h1>
        </div>
        {actions ? <div className="sq-page__actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

export function PageSection({ title, description, children, actions }: { title?: string; description?: string; children?: ReactNode; actions?: ReactNode }) {
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
