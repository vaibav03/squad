import { useRef, useState } from 'react';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Notice } from '../../primitives/Notice';
import { Skeleton } from '../../primitives/Skeleton';
import { ExternalExcerptBody } from './ExternalExcerpt';
import { isExternalExcerpt, type PdfSourceExcerpt, type SourceExcerpt } from './types';
import './source-viewer.css';

export type SourceViewPhase = 'loading' | 'ready' | 'error' | 'offline';

export interface SourceExcerptViewProps {
  excerpt?: SourceExcerpt | null;
  state: SourceViewPhase;
  onRetry?: () => void;
  /** Go to another page of the same file (page +/- 1, no quote). */
  onPage?: (page: number) => void;
  /** Override the default plain-link behaviour of "Open in file" (e.g. authed blob open). */
  onOpenFile?: (excerpt: PdfSourceExcerpt) => void;
  /** Absolute href used as the plain link fallback. */
  openHref?: string;
  onClose?: () => void;
}

export function liveMessage(excerpt: SourceExcerpt | null | undefined): string {
  if (!excerpt || !excerpt.ok || !excerpt.quote) return '';
  if (isExternalExcerpt(excerpt))
    return excerpt.quoteVerified ? `Verified quote found in ${excerpt.title}` : 'Quote not found';
  return excerpt.quoteVerified ? `Verified quote found on page ${excerpt.page}` : 'Quote not found';
}

export function SourceExcerptView({
  excerpt,
  state,
  onRetry,
  onPage,
  onOpenFile,
  openHref,
  onClose,
}: SourceExcerptViewProps) {
  const [copied, setCopied] = useState('');
  const hitRef = useRef<HTMLDivElement>(null);
  const message = state === 'ready' ? liveMessage(excerpt) : '';

  const body = (() => {
    if (state === 'loading') {
      return (
        <div className="sq-source__loading" aria-busy="true">
          <span className="sq-sr-only">Loading source</span>
          <Skeleton width="60%" />
          <Skeleton />
          <Skeleton />
          <Skeleton width="80%" />
          <Skeleton />
        </div>
      );
    }
    if (state === 'offline' || state === 'error') {
      const offline = state === 'offline';
      return (
        <Notice
          tone={offline ? 'warn' : 'error'}
          title={offline ? "You're offline" : "Couldn't load this source"}
          action={
            onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {offline
            ? 'Reconnect and try again. Your course material is not lost.'
            : 'Something went wrong reaching the library. Try again in a moment.'}
        </Notice>
      );
    }
    if (!excerpt) return null;
    if (!excerpt.ok) {
      const copy = {
        removed: {
          title: 'This source was removed from the library',
          text: 'The file is no longer available, so the cited text cannot be shown. Ask the course owner to add it back, or check the answer against your own copy.',
        },
        page_missing: {
          title: 'That page is not in this file',
          text: 'The citation points to a page the file does not have. The file may have been replaced with a shorter version.',
        },
        revoked: {
          title: 'Access to this source was revoked',
          text: 'The Canvas or Google connection was disconnected, so its imported text was deleted and can no longer be shown. Reconnect to bring it back, or check the answer against the original.',
        },
        not_found: {
          title: 'Source not found',
          text: 'This citation does not match any file in the course library. It may belong to a different course.',
        },
      }[excerpt.reason];
      return (
        <Notice tone="warn" title={copy.title}>
          {copy.text}
          {onClose ? (
            <div className="sq-source__after">
              <Button size="sm" variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : null}
        </Notice>
      );
    }

    if (isExternalExcerpt(excerpt)) return <ExternalExcerptBody excerpt={excerpt} />;

    const hasHit = excerpt.lines.some((l) => l.hit);
    const quoteText =
      excerpt.quote ??
      excerpt.lines
        .filter((l) => l.hit)
        .map((l) => l.text)
        .join(' ');
    const alt = excerpt.lines[0]?.text.slice(0, 90) ?? `Page ${excerpt.page}`;

    const copyQuote = async () => {
      const text = excerpt.quote ?? quoteText;
      try {
        await navigator.clipboard.writeText(text);
        setCopied('Copied');
      } catch {
        try {
          const el = hitRef.current;
          if (el) {
            const sel = window.getSelection();
            const r = document.createRange();
            r.selectNodeContents(el);
            sel?.removeAllRanges();
            sel?.addRange(r);
            const ok = document.execCommand?.('copy');
            setCopied(ok ? 'Copied' : 'Quote selected. Press Ctrl+C to copy');
          } else {
            setCopied('Could not copy');
          }
        } catch {
          setCopied('Quote selected. Press Ctrl+C to copy');
        }
      }
      setTimeout(() => setCopied(''), 2500);
    };

    return (
      <>
        {excerpt.quote ? (
          excerpt.quoteVerified ? (
            <p className="sq-source__verdict sq-source__verdict--ok">
              <Icon name="check" size={16} />
              <span>Verified quote</span>
            </p>
          ) : (
            <Notice tone="warn" title="Quote not on this page">
              The cited wording could not be found here. The page text is shown below so you can
              check it yourself.
            </Notice>
          )
        ) : null}

        <div className="sq-source__text" ref={hitRef} data-has-hit={hasHit || undefined}>
          {excerpt.lines.map((l) => (
            <div key={l.n} className={`sq-source__line${l.hit ? ' is-hit' : ''}`}>
              <span className="sq-source__n" aria-hidden="true">
                {l.n}
              </span>
              {l.hit ? (
                <mark className="sq-source__mark">
                  <span className="sq-sr-only">Quoted text: </span>
                  {l.text}
                </mark>
              ) : (
                <span className="sq-source__plain">{l.text}</span>
              )}
            </div>
          ))}
        </div>

        {excerpt.imageUrl ? (
          <figure className="sq-source__figure">
            <img className="sq-source__img" src={excerpt.imageUrl} alt={alt} loading="lazy" />
          </figure>
        ) : null}

        <div className="sq-source__actions">
          {quoteText ? (
            <Button size="md" variant="secondary" iconStart="link" onClick={copyQuote}>
              Copy quote
            </Button>
          ) : null}
          <Button
            as="a"
            size="md"
            variant="secondary"
            iconStart="file"
            href={`${openHref ?? excerpt.openUrl}#page=${excerpt.page}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={
              onOpenFile
                ? (e: React.MouseEvent) => {
                    e.preventDefault();
                    onOpenFile(excerpt);
                  }
                : undefined
            }
          >
            Open in file
          </Button>
        </div>
        <span className="sq-sr-only" role="status" aria-live="polite">
          {copied}
        </span>

        {onPage ? (
          <nav className="sq-source__pager" aria-label="Page navigation">
            <Button
              size="md"
              variant="ghost"
              iconStart="chevron-left"
              disabled={excerpt.page <= 1}
              onClick={() => onPage(excerpt.page - 1)}
            >
              Previous page
            </Button>
            <span className="sq-source__pageno">
              {excerpt.page} / {excerpt.pageCount}
            </span>
            <Button
              size="md"
              variant="ghost"
              iconEnd="chevron-right"
              disabled={excerpt.page >= excerpt.pageCount}
              onClick={() => onPage(excerpt.page + 1)}
            >
              Next page
            </Button>
          </nav>
        ) : null}
      </>
    );
  })();

  return (
    <div className="sq-source">
      {excerpt && excerpt.ok ? (
        <p className="sq-source__tag">
          {isExternalExcerpt(excerpt) ? excerpt.title : excerpt.file}
        </p>
      ) : null}
      {body}
      <div className="sq-sr-only" role="status" aria-live="polite" data-testid="source-live">
        {message}
      </div>
    </div>
  );
}
