import type { SourceExcerpt, SourceLine } from './types';

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
};
