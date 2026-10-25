import { SourceViewerHost, openSource as open } from '../../components/source-viewer';
import type { Citation } from './types';

/** Open one cited page in the shared source viewer. */
export function openSource(c: Citation): void {
  open(c);
}

export function SourceHost() {
  return <SourceViewerHost />;
}
