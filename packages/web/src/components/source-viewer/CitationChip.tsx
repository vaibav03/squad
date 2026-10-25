import { forwardRef, type MouseEvent } from 'react';
import { citationLabel } from './parse';
import { openSource } from './store';
import type { SourceCitation } from './types';
import './source-viewer.css';

export interface CitationChipProps {
  citation: SourceCitation;
  /** Called after the viewer is requested. */
  onOpen?: (citation: SourceCitation) => void;
  className?: string;
}

/** `slides.pdf p.12` button; opens the source viewer and gets focus back on close. */
export const CitationChip = forwardRef<HTMLButtonElement, CitationChipProps>(function CitationChip(
  { citation, onOpen, className },
  ref,
) {
  const label = citationLabel(citation.file, citation.page);
  return (
    <button
      ref={ref}
      type="button"
      className={['sq-cite', className].filter(Boolean).join(' ')}
      aria-haspopup="dialog"
      aria-label={`Source: ${citation.file}, page ${citation.page}`}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        const c = { ...citation, returnFocusTo: citation.returnFocusTo ?? e.currentTarget };
        openSource(c);
        onOpen?.(c);
      }}
    >
      <span className="sq-cite__label">{label}</span>
    </button>
  );
});
