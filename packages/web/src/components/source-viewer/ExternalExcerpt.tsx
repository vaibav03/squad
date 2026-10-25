import { useState } from 'react';
import { Button } from '../../primitives/Button';
import { Icon } from '../../primitives/Icon';
import { Notice } from '../../primitives/Notice';
import { OPEN_IN_LABEL, safeExternalUrl, SOURCE_KIND_LABEL } from './parse';
import type { ExternalSourceExcerpt } from './types';

/** Body for a Canvas / Drive / Calendar / Classroom source: anchored text, provenance badge, external link. */
export function ExternalExcerptBody({ excerpt }: { excerpt: ExternalSourceExcerpt }) {
  const [copied, setCopied] = useState('');
  const href = safeExternalUrl(excerpt.externalUrl);
  const fixture = excerpt.provenance === 'fixture';
  const quoteText =
    excerpt.quote ??
    excerpt.lines
      .filter((l) => l.hit)
      .map((l) => l.text)
      .join(' ');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(quoteText);
      setCopied('Copied');
    } catch {
      setCopied('Could not copy');
    }
    setTimeout(() => setCopied(''), 2500);
  };
  const open = OPEN_IN_LABEL[excerpt.sourceKind];
  return (
    <>
      <p className="sq-source__badges">
        <span className="sq-source__badge">{SOURCE_KIND_LABEL[excerpt.sourceKind]}</span>
        {fixture ? (
          <span className="sq-source__badge sq-source__badge--demo" data-testid="source-fixture">
            Demo data, not a real account
          </span>
        ) : null}
        {excerpt.shared ? <span className="sq-source__badge">Shared by a squad member</span> : null}
      </p>
      {excerpt.quote ? (
        excerpt.quoteVerified ? (
          <p className="sq-source__verdict sq-source__verdict--ok">
            <Icon name="check" size={16} />
            <span>Verified quote</span>
          </p>
        ) : (
          <Notice tone="warn" title="Quote not in this source">
            The cited wording could not be found here. The source text is shown below so you can
            check it yourself.
          </Notice>
        )
      ) : null}
      {excerpt.section && excerpt.section !== excerpt.title ? (
        <p className="sq-source__tag">{excerpt.section}</p>
      ) : null}
      <div className="sq-source__text" data-has-hit={excerpt.lines.some((l) => l.hit) || undefined}>
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
      <div className="sq-source__actions">
        {quoteText ? (
          <Button size="md" variant="secondary" iconStart="link" onClick={copy}>
            Copy quote
          </Button>
        ) : null}
        {href ? (
          <Button
            as="a"
            size="md"
            variant="secondary"
            iconStart="file"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {fixture ? `${open} (demo link)` : open}
          </Button>
        ) : null}
      </div>
      <span className="sq-sr-only" role="status" aria-live="polite">
        {copied}
      </span>
    </>
  );
}
