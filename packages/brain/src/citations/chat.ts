import type { ChatCitation, Citation, CitationSource } from '@squad/core';
import type { ContextSource } from '../context/types';

/** A synced Canvas/Drive/Calendar source as a chat citation chip (`file` is the title, page 1, `source` set). */
export function chatCitationForSource(
  s: Pick<ContextSource, 'kind' | 'id' | 'title' | 'url'>,
  anchor?: string,
): ChatCitation {
  const source: CitationSource = {
    kind: s.kind,
    id: s.id,
    ...(anchor ? { anchor } : {}),
    title: s.title,
    ...(s.url ? { url: s.url } : {}),
  };
  return { file: s.title, page: 1, label: s.title, source };
}

/**
 * Chat citations for the non-PDF citations of a brain answer. PDF citations are not returned: their
 * `(file p.N)` markers stay in the text and the chat transport turns them into chips.
 */
export function chatCitationsFromAnswer(citations: readonly Citation[]): ChatCitation[] {
  return citations.flatMap((c) =>
    c.source
      ? [
          {
            file: c.source.title ?? c.file,
            page: 1,
            label: c.source.title ?? c.file,
            source: c.source,
            ...(c.quote ? { quote: c.quote.slice(0, 600) } : {}),
          },
        ]
      : [],
  );
}
