import { quoteOnPage } from '../citations';
import type { Brain } from '../experts/types';
import type { Page } from '../ingest/types';
import type { CouncilDataPorts, RetrievedPage, RetrievedQuote } from './types';

const PAGE_CHARS = 9000;

/**
 * `retrieve_course` + the citation gate over the existing citation-checked brain: `brain.ask` routes to the chapter
 * expert (whose own claims are verified in code) and the pages it consulted become the agent's evidence. Every
 * citation an agent submits is later re-verified against exactly those pages (`verify`), so an invented quote
 * never reaches an envelope. Build one per run (the page cache is the run's evidence set).
 */
export function createCoursePorts(
  brain: Brain,
  courseId: string,
): Required<Pick<CouncilDataPorts, 'retrieve' | 'verify'>> {
  const seen = new Map<string, Page>();
  return {
    async retrieve(query) {
      const a = await brain.ask(courseId, query);
      if (!a.grounded || a.chapters.length === 0)
        return { grounded: false, quotes: [], pages: [], note: 'Not in the course materials.' };
      const pages = a.chapters.flatMap((c) => brain.store.getPages(courseId, c));
      if (pages.length === 0)
        return { grounded: false, quotes: [], pages: [], note: 'Not in the course materials.' };
      const cited = new Set(a.citations.map((c) => `${c.file}#${c.page ?? 0}`));
      const ordered = [...pages].sort(
        (x, y) =>
          Number(cited.has(`${y.file}#${y.page}`)) - Number(cited.has(`${x.file}#${x.page}`)),
      );
      let used = 0;
      const out: RetrievedPage[] = [];
      for (const p of ordered) {
        if (used + p.text.length > PAGE_CHARS && out.length > 0) break;
        out.push({ file: p.file, page: p.page, text: p.text });
        seen.set(`${p.file}\u0000${p.page}`, p);
        used += p.text.length;
      }
      const quotes: RetrievedQuote[] = a.claims.map((c) => ({
        file: c.file,
        page: c.page,
        quote: c.quote,
      }));
      return { grounded: true, quotes, pages: out };
    },
    verify(cs) {
      const keep = new Set<string>();
      const out: { file: string; page: number; label: string }[] = [];
      for (const c of cs) {
        const p = seen.get(`${c.file}\u0000${c.page}`);
        const k = `${c.file}#${c.page}`;
        if (!p || keep.has(k) || !quoteOnPage(c.quote, p.text)) continue;
        keep.add(k);
        out.push({ file: c.file, page: c.page, label: `${c.file} p.${c.page}` });
      }
      return out;
    },
  };
}
