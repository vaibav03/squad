import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveConfig } from '../../overlays/kit/live-config';
import { Sheet } from '../../primitives/Sheet';
import { citationKey, fetchRawObjectUrl, getCached, loadSource, OfflineError } from './data';
import { SourceExcerptView, type SourceViewPhase } from './SourceExcerptView';
import { closeSource, registerHost, useCurrentSource } from './store';
import {
  isExternalExcerpt,
  type PdfSourceExcerpt,
  type SourceCitation,
  type SourceExcerpt,
} from './types';

function useDesktop(): boolean {
  const [d, setD] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(min-width: 768px)').matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setD(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return d;
}

interface Loaded {
  phase: SourceViewPhase;
  excerpt: SourceExcerpt | null;
}

/** Mount once per page. Opened by `openSource()` / `<CitationChip />`. */
export function SourceViewerHost() {
  const request = useCurrentSource();
  const cfg = useLiveConfig();
  const desktop = useDesktop();
  const [page, setPage] = useState<number | null>(null);
  const [noQuote, setNoQuote] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({ phase: 'loading', excerpt: null });
  const lastFocus = useRef<HTMLElement | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  useEffect(() => registerHost(), []);

  // New request resets navigation.
  useEffect(() => {
    if (request) {
      lastFocus.current = request.returnFocusTo ?? lastFocus.current;
      setPage(null);
      setNoQuote(false);
      setAttempt(0);
    }
  }, [request]);

  const effective: SourceCitation | null = request
    ? {
        ...request,
        page: page ?? request.page,
        quote: noQuote ? undefined : request.quote,
      }
    : null;
  const key = effective ? citationKey(effective, cfg) : null;

  useEffect(() => {
    if (!effective || !key) return;
    const cached = getCached(key);
    if (cached) {
      setLoaded({ phase: 'ready', excerpt: cached });
      return;
    }
    setLoaded({ phase: 'loading', excerpt: null });
    let live = true;
    const { promise, release } = loadSource(effective, cfgRef.current);
    promise.then(
      (excerpt) => live && setLoaded({ phase: 'ready', excerpt }),
      (e: unknown) => {
        if (!live || (e as Error)?.name === 'AbortError') return;
        setLoaded({ phase: e instanceof OfflineError ? 'offline' : 'error', excerpt: null });
      },
    );
    return () => {
      live = false;
      release();
    };
  }, [key, attempt]);

  const close = useCallback(() => {
    const el = lastFocus.current;
    closeSource();
    // FocusTrap restores to the pre-open element; make the invoker win when it differs.
    if (el && typeof el.focus === 'function') setTimeout(() => el.isConnected && el.focus(), 0);
  }, []);

  const openFile = useCallback(async (ex: PdfSourceExcerpt) => {
    const c = cfgRef.current;
    const abs = /^https?:/i.test(ex.openUrl)
      ? ex.openUrl
      : `${(c.hubUrl ?? '').replace(/\/$/, '')}${ex.openUrl}`;
    if (c.mode !== 'live') return; // preview mode: nothing to open
    try {
      const url = await fetchRawObjectUrl(ex.openUrl, c);
      window.open(`${url}#page=${ex.page}`, '_blank', 'noopener');
    } catch {
      window.open(`${abs}#page=${ex.page}`, '_blank', 'noopener');
    }
  }, []);

  if (!effective) return null;
  const shown =
    loaded.excerpt && loaded.excerpt.ok && !isExternalExcerpt(loaded.excerpt)
      ? loaded.excerpt
      : null;
  const title = effective.source ? effective.file : `${effective.file}, page ${effective.page}`;

  return (
    <Sheet open={!!request} onClose={close} title={title} side={desktop ? 'right' : 'bottom'}>
      <SourceExcerptView
        excerpt={loaded.excerpt}
        state={loaded.phase}
        onRetry={() => setAttempt((n) => n + 1)}
        onClose={close}
        onPage={
          shown
            ? (p) => {
                setPage(p);
                setNoQuote(true);
              }
            : undefined
        }
        onOpenFile={openFile}
      />
    </Sheet>
  );
}
