import type { ContextStore } from './store';
import type { ContextViewer } from './types';
import { ownSources } from './readable';

export interface StudySeed {
  kind: 'due' | 'lecture';
  title: string;
  /** ISO due date for `due` items; null for lecture topics. */
  dueAt: string | null;
  courseId: string | null;
  sourceUri: string;
}

/**
 * Seeds for a shared study plan from the viewer's own readable sources: upcoming due dates (assignments,
 * Classroom items) and lecture topics (slide/PDF files and the section headings of their chunks).
 */
export function deriveStudySeeds(
  store: ContextStore,
  viewer: ContextViewer,
  now: number,
  opts: { horizonMs?: number } = {},
): StudySeed[] {
  const horizon = now + (opts.horizonMs ?? 60 * 24 * 3_600_000);
  const out: StudySeed[] = [];
  for (const s of ownSources(store, viewer)) {
    if ((s.kind === 'canvas_assignment' || s.kind === 'classroom_item') && s.dueAt !== null) {
      if (s.dueAt >= now && s.dueAt <= horizon)
        out.push({
          kind: 'due',
          title: s.title,
          dueAt: new Date(s.dueAt).toISOString(),
          courseId: s.courseId,
          sourceUri: s.uri,
        });
    } else if (
      (s.kind === 'canvas_file' || s.kind === 'gdoc' || s.kind === 'gdrive_file') &&
      /\.(pptx?|pdf|docx?)$|lecture|slides/i.test(s.title)
    ) {
      const sections = [
        ...new Set(
          store
            .chunks(s.id)
            .map((c) => c.section)
            .filter((x): x is string => !!x),
        ),
      ].slice(0, 6);
      for (const topic of sections.length ? sections : [s.title])
        out.push({
          kind: 'lecture',
          title: topic,
          dueAt: null,
          courseId: s.courseId,
          sourceUri: s.uri,
        });
    }
  }
  return out.sort(
    (a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9') || a.title.localeCompare(b.title),
  );
}
