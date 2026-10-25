import type { ChapterProvider } from './types';

/** Structural subset of brain-answers' `CourseStore`, so quiz code never imports ingest internals. */
export interface CourseStoreLike {
  chapterContext(courseId: string, chapterId: string): string;
  listChapters?(courseId: string): { id: string }[];
}

export function chapterProviderFromStore(store: CourseStoreLike): ChapterProvider {
  return {
    chapterContext: async (courseId, chapter) => store.chapterContext(courseId, chapter),
  };
}

export function chapterIdsFromStore(store: CourseStoreLike): (courseId: string) => string[] {
  return (courseId) => store.listChapters?.(courseId).map((c) => c.id) ?? [];
}
