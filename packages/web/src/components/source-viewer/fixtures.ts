import type { ExternalSourceExcerpt, SourceCitation, SourceExcerpt, SourceLine } from './types';

export const SAMPLE_FILE = 'openstax-biology.pdf';
const PAGE_COUNT = 40;

const SAMPLE_LINES: string[] = [
  'Cellular respiration is the process by which cells convert glucose into usable energy.',
  'Glycolysis takes place in the cytoplasm and splits one glucose molecule into two pyruvate molecules.',
  'The net gain from glycolysis is two ATP and two NADH for every glucose molecule.',
  'Pyruvate then enters the mitochondrion, where the citric acid cycle continues the breakdown.',
  'Most of the ATP is made during oxidative phosphorylation along the inner membrane.',
  'Oxygen acts as the final electron acceptor and combines with hydrogen to form water.',
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Built-in data for mock mode. Magic names: *removed* -> removed, *missing* -> not_found. */
export function mockExcerpt(c: {
  file: string;
  page: number;
  quote?: string;
  courseId?: string;
}): SourceExcerpt {
  if (/removed/i.test(c.file)) return { ok: false, reason: 'removed' };
  if (/missing|unknown/i.test(c.file)) return { ok: false, reason: 'not_found' };
  if (c.page < 1 || c.page > PAGE_COUNT) return { ok: false, reason: 'page_missing' };
  const q = c.quote ? norm(c.quote) : '';
  let found = false;
  const lines: SourceLine[] = SAMPLE_LINES.map((text, i) => {
    const hit = !!q && !found && norm(text).includes(q);
    if (hit) found = true;
    return { n: i + 1, text, hit };
  });
  return {
    ok: true,
    courseId: c.courseId ?? 'sample-openstax',
    fileId: 'f_sample',
    file: c.file,
    page: c.page,
    pageCount: PAGE_COUNT,
    lines,
    quote: c.quote ?? null,
    quoteVerified: found,
    imageUrl: null,
    openUrl: `/v1/library/raw?file=${encodeURIComponent(c.file)}`,
  };
}

const ASSIGNMENT_LINES = [
  'Due: 2026-11-02T23:59:00Z',
  'Worth 40 points.',
  'Simulate drawing 500 samples of size 30 from the provided skewed population and plot the distribution of the sample means.',
  'Submit one PDF. Late work loses 10 percent per day.',
];

/** Mock-mode data for non-PDF citations. Magic ids: *removed* -> removed, *revoked* -> revoked, *missing* -> not_found. */
export function mockExternalExcerpt(
  c: Pick<SourceCitation, 'source' | 'quote' | 'courseId'>,
): SourceExcerpt {
  const src = c.source!;
  if (/revoked/i.test(src.id)) return { ok: false, reason: 'revoked' };
  if (/removed/i.test(src.id)) return { ok: false, reason: 'removed' };
  if (/missing|unknown/i.test(src.id)) return { ok: false, reason: 'not_found' };
  const q = c.quote ? norm(c.quote) : '';
  const lines: SourceLine[] = ASSIGNMENT_LINES.map((text, i) => ({
    n: i + 1,
    text,
    hit: !!q && norm(text).includes(q),
  }));
  return {
    ok: true,
    sourceKind: src.kind,
    sourceId: src.id,
    title: src.title ?? 'Assignment 3: Sampling Distributions',
    courseId: c.courseId ?? 'stat-101',
    anchor: src.anchor ?? 's1',
    section: null,
    lines,
    quote: c.quote ?? null,
    quoteVerified: lines.some((l) => l.hit),
    externalUrl: src.url ?? 'https://canvas.fixture.invalid/courses/stat101/assignments/a301',
    provider: src.kind.startsWith('canvas') ? 'canvas' : 'google',
    provenance: 'fixture',
    fetchedAt: 0,
    shared: false,
  } satisfies ExternalSourceExcerpt;
}

export const sourceFixtures = {
  verified: mockExcerpt({
    file: SAMPLE_FILE,
    page: 12,
    quote: 'splits one glucose molecule into two pyruvate molecules',
  }),
  unverified: mockExcerpt({
    file: SAMPLE_FILE,
    page: 12,
    quote: 'This sentence is not on the page',
  }),
  removed: mockExcerpt({ file: 'removed-notes.pdf', page: 3 }),
  notFound: mockExcerpt({ file: 'missing.pdf', page: 1 }),
  pageMissing: mockExcerpt({ file: SAMPLE_FILE, page: 999 }),
  canvasVerified: mockExternalExcerpt({
    source: {
      kind: 'canvas_assignment',
      id: 'src_a301',
      anchor: 's1',
      title: 'Assignment 3: Sampling Distributions',
    },
    quote: 'Late work loses 10 percent per day',
  }),
  canvasUnverified: mockExternalExcerpt({
    source: { kind: 'canvas_assignment', id: 'src_a301', anchor: 's1' },
    quote: 'Late work is forgiven for everyone',
  }),
  revoked: mockExternalExcerpt({ source: { kind: 'canvas_assignment', id: 'src_revoked' } }),
  externalRemoved: mockExternalExcerpt({ source: { kind: 'gdoc', id: 'src_removed' } }),
};
