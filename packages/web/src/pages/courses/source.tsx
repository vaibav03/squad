import { useEffect, useState, type ComponentType } from 'react';
import { Button, Sheet } from '../../primitives';
import { useLiveConfig } from '../../overlays/kit';
import type { Citation } from './types';

/**
 * The source viewer is built by another workstream (components/source-viewer). It is discovered at
 * build time so this page works before it lands and picks it up the moment it does, with no edit here.
 */
interface ViewerModule {
  openSource?: (c: Citation) => void;
  SourceViewerHost?: ComponentType;
}
const found = import.meta.glob('../../components/source-viewer/index.ts*', {
  eager: true,
}) as Record<string, ViewerModule>;
const viewer: ViewerModule | undefined = Object.values(found)[0];

export const hasSourceViewer = typeof viewer?.openSource === 'function';

const listeners = new Set<(c: Citation) => void>();

/** Open one cited page. Uses the real viewer when present, else the local stand-in sheet. */
export function openSource(c: Citation): void {
  if (viewer?.openSource) viewer.openSource(c);
  else listeners.forEach((l) => l(c));
}

/** Mount once on the page: the real host if it exists, otherwise the stand-in. */
export function SourceHost({ fileName }: { fileName?: (id: string) => string | undefined }) {
  const Host = viewer?.SourceViewerHost;
  if (Host) return <Host />;
  return <FallbackSource fileName={fileName} />;
}

function FallbackSource({ fileName }: { fileName?: (id: string) => string | undefined }) {
  const cfg = useLiveConfig();
  const [c, setC] = useState<Citation | null>(null);
  useEffect(() => {
    listeners.add(setC);
    return () => {
      listeners.delete(setC);
    };
  }, []);
  const live = cfg.mode === 'live' && !!cfg.hubUrl;
  const href = c && live ? `${cfg.hubUrl}/v1/library/files/${encodeURIComponent(c.file)}/raw#page=${c.page}` : null;
  return (
    <Sheet
      open={!!c}
      onClose={() => setC(null)}
      title={c ? `Page ${c.page}` : 'Source'}
      description={c ? (fileName?.(c.file) ?? 'Course material') : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => setC(null)}>
            Close
          </Button>
          {href ? (
            <Button as="a" variant="primary" href={href} target="_blank" rel="noreferrer noopener">
              Open the original
            </Button>
          ) : null}
        </>
      }
    >
      <p className="cr-muted">
        {live
          ? 'The page viewer is not available in this build. You can still open the original file at this page.'
          : 'This is demo data, so there is no original file to show. With your own course, this opens the exact page.'}
      </p>
    </Sheet>
  );
}
