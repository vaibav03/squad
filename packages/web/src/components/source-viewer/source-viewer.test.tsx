// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LiveConfigProvider } from '../../overlays/kit/live-config';
import {
  CitationChip,
  SourceExcerptView,
  SourceViewerHost,
  openSource,
  parseCitationString,
  parseSourceUri,
  sourceFixtures,
} from './index';
import { clearSourceCache } from './data';
import { __resetSourceStore } from './store';

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};
const Q = 'splits one glucose molecule into two pyruvate molecules';

beforeEach(() => {
  __resetSourceStore();
  clearSourceCache();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('parseCitationString', () => {
  it('parses bracket and paren forms', () => {
    expect(parseCitationString('[slides.pdf p.12]')).toEqual({ file: 'slides.pdf', page: 12 });
    expect(parseCitationString('(my notes.pdf p. 3)')).toEqual({ file: 'my notes.pdf', page: 3 });
  });
  it('rejects junk', () => {
    expect(parseCitationString('slides.pdf p.12')).toBeNull();
    expect(parseCitationString('[slides.pdf p.0]')).toBeNull();
    expect(parseCitationString('[p.3]')).toBeNull();
  });
});

describe('SourceExcerptView', () => {
  it('verified: mark with sr prefix and label', () => {
    const { container } = render(
      <SourceExcerptView excerpt={sourceFixtures.verified} state="ready" />,
    );
    expect(screen.getByText('Verified quote')).toBeTruthy();
    const mark = container.querySelector('mark')!;
    expect(mark.textContent).toContain('Quoted text:');
    expect(mark.textContent).toContain('glucose');
    expect(screen.getByTestId('source-live').textContent).toBe('Verified quote found on page 12');
  });
  it('unverified: alert state, still shows page text', () => {
    const { container } = render(
      <SourceExcerptView excerpt={sourceFixtures.unverified} state="ready" />,
    );
    expect(screen.getByText('Quote not on this page')).toBeTruthy();
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.getByText(/Cellular respiration/)).toBeTruthy();
    expect(screen.getByTestId('source-live').textContent).toBe('Quote not found');
  });
  it('removed / not_found / page_missing / error / offline / loading', () => {
    const r = (ex: unknown, state: 'ready' | 'error' | 'offline' | 'loading') =>
      render(<SourceExcerptView excerpt={ex as never} state={state} onRetry={() => {}} />);
    r(sourceFixtures.removed, 'ready');
    expect(screen.getByText('This source was removed from the library')).toBeTruthy();
    cleanup();
    r(sourceFixtures.notFound, 'ready');
    expect(screen.getByText('Source not found')).toBeTruthy();
    cleanup();
    r(sourceFixtures.pageMissing, 'ready');
    expect(screen.getByText('That page is not in this file')).toBeTruthy();
    cleanup();
    r(null, 'error');
    expect(screen.getByText("Couldn't load this source")).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    cleanup();
    r(null, 'offline');
    expect(screen.getByText("You're offline")).toBeTruthy();
    cleanup();
    r(null, 'loading');
    expect(screen.getByText('Loading source')).toBeTruthy();
  });
  it('copy quote uses clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SourceExcerptView excerpt={sourceFixtures.verified} state="ready" />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy quote'));
    });
    expect(writeText).toHaveBeenCalledWith(Q);
    expect(screen.getByText('Copied')).toBeTruthy();
  });
});

describe('host', () => {
  const mount = () =>
    render(
      <>
        <CitationChip citation={{ file: 'openstax-biology.pdf', page: 12, quote: Q }} />
        <SourceViewerHost />
      </>,
    );

  it('opens from chip in mock mode, Escape closes and focus returns', async () => {
    mount();
    const chip = screen.getByRole('button', { name: /Source: openstax-biology.pdf, page 12/ });
    expect(chip.textContent).toBe('openstax-biology.pdf p.12');
    chip.focus();
    fireEvent.click(chip);
    await settle();
    expect(screen.getByRole('dialog', { name: 'openstax-biology.pdf, page 12' })).toBeTruthy();
    expect(screen.getByText('Verified quote')).toBeTruthy();
    expect(screen.getByTestId('source-live').textContent).toBe('Verified quote found on page 12');
    fireEvent.keyDown(document, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it('next page refetches without quote', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Source:/ }));
    await settle();
    fireEvent.click(screen.getByText('Next page'));
    await settle();
    expect(screen.getByRole('dialog', { name: 'openstax-biology.pdf, page 13' })).toBeTruthy();
    expect(screen.queryByText('Verified quote')).toBeNull();
  });

  it('removed source does not crash', async () => {
    render(<SourceViewerHost />);
    act(() => openSource({ file: 'removed-notes.pdf', page: 1 }));
    await settle();
    expect(screen.getByText('This source was removed from the library')).toBeTruthy();
  });

  it('queues openSource before the host mounts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openSource({ file: 'openstax-biology.pdf', page: 2 });
    expect(warn).toHaveBeenCalled();
    render(<SourceViewerHost />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'openstax-biology.pdf, page 2' })).toBeTruthy();
  });

  it('live mode: sends bearer, shows error + retry, aborts after close', async () => {
    let signal: AbortSignal | undefined;
    let headers: Record<string, string> | undefined;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      headers = init.headers as Record<string, string>;
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LiveConfigProvider value={{ mode: 'live', hubUrl: 'http://hub', token: 'tok', userId: 'u' }}>
        <SourceViewerHost />
      </LiveConfigProvider>,
    );
    act(() => openSource({ file: 'a.pdf', page: 1, quote: 'x y', courseId: 'c1' }));
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('http://hub/v1/library/source?');
    expect(url).toContain('courseId=c1');
    expect(headers).toEqual({ Authorization: 'Bearer tok' });
    expect(signal!.aborted).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await settle();
    expect(signal!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('live mode: server error then retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, json: async () => ({ error: 'x' }) })
      .mockResolvedValueOnce({ status: 200, json: async () => sourceFixtures.verified });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LiveConfigProvider value={{ mode: 'live', hubUrl: 'http://hub', token: 't', userId: 'u' }}>
        <SourceViewerHost />
      </LiveConfigProvider>,
    );
    act(() => openSource({ file: 'a.pdf', page: 1 }));
    await settle();
    expect(screen.getByText("Couldn't load this source")).toBeTruthy();
    fireEvent.click(screen.getByText('Try again'));
    await settle();
    expect(screen.getByText('Verified quote')).toBeTruthy();
  });
});

describe('non-PDF sources (Canvas / Drive / Calendar)', () => {
  const CQ = 'Late work loses 10 percent per day';
  const ref = {
    kind: 'canvas_assignment' as const,
    id: 'src_a301',
    anchor: 's1',
    title: 'Assignment 3: Sampling Distributions',
  };

  it('parses source URIs and rejects pdf/unknown kinds', () => {
    expect(parseSourceUri('source://canvas_assignment/src_1#s2')).toEqual({
      kind: 'canvas_assignment',
      id: 'src_1',
      anchor: 's2',
    });
    expect(parseSourceUri('source://pdf/x')).toBeNull();
    expect(parseSourceUri('source://nope/x')).toBeNull();
  });

  it('renders a verified Canvas quote, a demo badge and an external link', () => {
    const { container } = render(
      <SourceExcerptView excerpt={sourceFixtures.canvasVerified} state="ready" />,
    );
    expect(screen.getByText('Verified quote')).toBeTruthy();
    expect(screen.getByText('Canvas assignment')).toBeTruthy();
    expect(screen.getByTestId('source-fixture').textContent).toMatch(/not your account/);
    expect(container.querySelector('mark')!.textContent).toContain('Late work loses');
    const link = screen.getByRole('link', { name: /Open in Canvas/ }) as HTMLAnchorElement;
    expect(link.href).toContain('canvas.fixture.invalid');
    expect(link.rel).toContain('noopener');
    expect(screen.getByTestId('source-live').textContent).toBe(
      'Verified quote found in Assignment 3: Sampling Distributions',
    );
    expect(screen.queryByText('Next page')).toBeNull();
  });

  it('flags an unverified quote and never renders a javascript: link', () => {
    const { rerender } = render(
      <SourceExcerptView excerpt={sourceFixtures.canvasUnverified} state="ready" />,
    );
    expect(screen.getByText('Quote not in this source')).toBeTruthy();
    rerender(
      <SourceExcerptView
        excerpt={
          {
            ...(sourceFixtures.canvasVerified as object),
            externalUrl: 'javascript:alert(1)',
          } as never
        }
        state="ready"
      />,
    );
    expect(screen.queryByRole('link', { name: /Open in/ })).toBeNull();
  });

  it('shows a clear revoked state', () => {
    render(<SourceExcerptView excerpt={sourceFixtures.revoked} state="ready" onClose={() => {}} />);
    expect(screen.getByText('Access to this source was revoked')).toBeTruthy();
  });

  it('chip and host open a source citation in mock mode', async () => {
    render(
      <>
        <CitationChip citation={{ file: ref.title, page: 1, quote: CQ, source: ref }} />
        <SourceViewerHost />
      </>,
    );
    const chip = screen.getByRole('button', { name: /Source: Assignment 3.*Canvas assignment/ });
    expect(chip.textContent).toBe(ref.title);
    fireEvent.click(chip);
    await settle();
    expect(screen.getByRole('dialog', { name: ref.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open in Canvas/ })).toBeTruthy();
    expect(screen.getByText('Verified quote')).toBeTruthy();
  });

  it('live mode: calls /v1/context/source and shows revoked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ status: 200, json: async () => ({ ok: false, reason: 'revoked' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <LiveConfigProvider value={{ mode: 'live', hubUrl: 'http://hub', token: 't', userId: 'u' }}>
        <SourceViewerHost />
      </LiveConfigProvider>,
    );
    act(() => openSource({ file: ref.title, page: 1, quote: CQ, source: ref }));
    await settle();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('http://hub/v1/context/source?');
    expect(url).toContain('id=src_a301');
    expect(url).toContain('kind=canvas_assignment');
    expect(url).toContain('anchor=s1');
    expect(screen.getByText('Access to this source was revoked')).toBeTruthy();
  });
});
