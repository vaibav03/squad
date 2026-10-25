// Grounding: pages for a query through the existing citation-checked retrieval (Brain.ask), or a fixture course.
import { createRetrieveContext, type Brain, type ContextStore } from '@squad/brain';
import type { Grounder, LivePage } from './types';

const MAX_PAGES = 3;

/** Backed by the brain the council uses (`brain.ask` finds the chapters, we pass their pages on). */
export function createBrainGrounder(brain: Brain, courseId: () => string): Grounder {
  return {
    async ground(query) {
      try {
        const a = await brain.ask(courseId(), query);
        if (!a.grounded || a.chapters.length === 0) return { pages: [] };
        const all = a.chapters.flatMap((c) => brain.store.getPages(courseId(), c));
        const cited = new Set(a.citations.map((c) => `${c.file}#${c.page ?? 0}`));
        const ordered = [...all].sort(
          (x, y) =>
            Number(cited.has(`${y.file}#${y.page}`)) - Number(cited.has(`${x.file}#${x.page}`)),
        );
        return {
          pages: ordered
            .slice(0, MAX_PAGES)
            .map((p) => ({ file: p.file, page: p.page, text: p.text })),
        };
      } catch {
        return { pages: [] };
      }
    },
  };
}

/** Fixture course flavour (introductory statistics): sentences are verbatim from the committed OpenStax excerpt. */
export const FIXTURE_PAGES: { keys: RegExp; page: LivePage }[] = [
  {
    keys: /normal|z-?score|bell|distribution/i,
    page: {
      file: 'ch6-the-normal-distribution.pdf',
      page: 1,
      text: 'If you ask enough people about their shoe size, you will find that your graphed data is shaped like a bell curve and can be described as normally distributed.',
    },
  },
  {
    keys: /regress|correlat|line of best fit|scatter/i,
    page: {
      file: 'ch12-linear-regression.pdf',
      page: 2,
      text: 'The graph of a linear equation of the form y = a + bx is a straight line. Any line that is not vertical can be described by this equation.',
    },
  },
  {
    keys: /probab|chance|odds|event/i,
    page: {
      file: 'ch3-probability-topics.pdf',
      page: 1,
      text: 'Meteor showers are rare, but the probability of them occurring can be calculated. Probability is a measure that is associated with how certain we are of outcomes of a particular experiment.',
    },
  },
  {
    keys: /./,
    page: {
      file: 'ch2-descriptive-statistics.pdf',
      page: 1,
      text: 'The words mean and average are often used interchangeably. The substitution of one word for the other is common practice. The technical term is arithmetic mean and average is technically a center location.',
    },
  },
];

export function createFakeGrounder(): Grounder {
  return {
    ground(query) {
      const hit = FIXTURE_PAGES.find((f) => f.keys.test(query)) ?? FIXTURE_PAGES.at(-1)!;
      return Promise.resolve({ pages: [hit.page] });
    },
  };
}

/** No materials at all: the agents say it is general reasoning. */
export const noGrounder: Grounder = { ground: () => Promise.resolve({ pages: [] }) };

/** Demo runs always end up with sources: when retrieval finds nothing, use the fixture course pages. Real runs never do. */
export function withDemoFallback(
  primary: Grounder,
  fixture: Grounder = createFakeGrounder(),
): Grounder {
  return {
    async ground(q, o) {
      const r = await primary.ground(q, o);
      return r.pages.length > 0 || !o?.demo ? r : fixture.ground(q, o);
    },
  };
}

/**
 * Adds the viewer's connected sources (Canvas, Drive, Calendar) to the agents' SOURCES through the viewer-bound
 * `retrieve` tool (docs/context-store.md). The viewer is fixed per call from the run's asker; without a viewer
 * nothing from the context store is read. A chunk becomes a page `file = title, page = chunk ordinal`, so the
 * existing `[file p.N]` marker verification applies to it unchanged.
 */
export function withContext(primary: Grounder, store: ContextStore, limit = 3): Grounder {
  return {
    async ground(q, o) {
      const base = await primary.ground(q, o);
      if (!o?.viewer) return base;
      const hits = await createRetrieveContext(store, o.viewer, { limit })(q);
      const extra: LivePage[] = hits.map((h, i) => ({
        file: h.title,
        page: h.page ?? i + 1,
        text: h.text,
      }));
      return { pages: [...base.pages, ...extra] };
    },
  };
}
