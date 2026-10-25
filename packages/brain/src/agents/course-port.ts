import { quoteOnPage } from '../citations';
import type { Brain } from '../experts/types';
import type { Page } from '../ingest/types';
import type { RetrieveContext, RetrievedChunk } from '../context/retrieve';
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

const CALENDAR_KINDS = new Set(['gcal_event', 'canvas_event']);
const pageOfAnchor = (anchor: string, fallback: number): number => {
  const n = /(\d+)/.exec(anchor)?.[1];
  return n ? Math.max(1, Number(n)) : fallback;
};

/**
 * Adds the viewer's imported context (Canvas files and assignments, Google Docs/Drive files, Classroom items) to the
 * council's `retrieve_course` tool. `ctx` is bound to ONE viewer (visibility is decided in SQL before any text is
 * loaded), calendar events never go through here (the privacy-gated `calendar_summary` tool owns them), and every
 * citation is re-verified against exactly the chunk text the agent was shown: file = the source title, page = the
 * chunk's page number (or its section ordinal), so the cite reads `[Lecture 3 notes p.2]`.
 */
export function withContextPorts(
  course: Required<Pick<CouncilDataPorts, 'retrieve' | 'verify'>> | undefined,
  ctx: RetrieveContext | undefined,
  opts: { keep?: (c: RetrievedChunk) => boolean } = {},
): Required<Pick<CouncilDataPorts, 'retrieve' | 'verify'>> | undefined {
  if (!ctx) return course;
  const seen = new Map<string, string>();
  return {
    async retrieve(query) {
      const base = course
        ? await course.retrieve(query)
        : { grounded: false, quotes: [], pages: [] as RetrievedPage[] };
      const chunks = (await ctx(query)).filter(
        (c) => !CALENDAR_KINDS.has(c.kind) && (opts.keep ? opts.keep(c) : true),
      );
      if (chunks.length === 0) return base;
      const pages = [...base.pages];
      const quotes = [...base.quotes];
      chunks.forEach((c, i) => {
        const page = pageOfAnchor(c.anchor, i + 1);
        const key = `${c.title}\u0000${page}`;
        const prev = seen.get(key);
        const text = prev && !prev.includes(c.text) ? `${prev}\n${c.text}` : c.text;
        seen.set(key, text);
        const at = pages.findIndex((p) => p.file === c.title && p.page === page);
        if (at >= 0) pages[at] = { file: c.title, page, text };
        else pages.push({ file: c.title, page, text });
        if (c.citation.quote) quotes.push({ file: c.title, page, quote: c.citation.quote });
      });
      return { grounded: true, quotes, pages };
    },
    verify(cs) {
      const imported: RetrievedQuote[] = [];
      const rest: RetrievedQuote[] = [];
      for (const c of cs) {
        const t = seen.get(`${c.file}\u0000${c.page}`);
        if (t !== undefined) imported.push(c);
        else rest.push(c);
      }
      const ok = imported
        .filter((c) => quoteOnPage(c.quote, seen.get(`${c.file}\u0000${c.page}`)!))
        .map((c) => ({ file: c.file, page: c.page, label: `${c.file} p.${c.page}` }));
      const seenKeys = new Set<string>();
      return [...(course ? course.verify(rest) : []), ...ok].filter((c) => {
        const k = `${c.file}#${c.page}`;
        if (seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });
    },
  };
}
