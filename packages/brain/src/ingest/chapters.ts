import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Llm } from '@squad/core';
import type { Chapter, CourseStore } from './types';

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\.pdf$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chapter';

/** `ch3-probability.pdf` -> `ch3`; otherwise the file slug. */
export function chapterIdFromFile(file: string): string {
  const m = /^(?:ch|chapter)[-_ ]?(\d+)/i.exec(file);
  return m ? `ch${m[1]}` : slugify(file);
}

export interface Section {
  id: string;
  title: string;
  startIndex: number; // 0-based page index into the file
}

const HEADING = /^\s*(?:chapter\s+(\d+)[\s:.\-–—]+(.+)|(\d{1,2})\s*\|\s*(.+))$/i;

/** Detect `Chapter N Title` page headings in one big PDF. Returns [] when none are found. */
export function detectSections(pages: string[]): Section[] {
  const out: Section[] = [];
  const seen = new Set<string>();
  pages.forEach((text, i) => {
    const first = text.split('\n').find((l) => l.trim().length > 0) ?? '';
    const m = HEADING.exec(first);
    if (!m) return;
    const n = m[1] ?? m[3];
    const title = (m[2] ?? m[4] ?? '').trim();
    const id = `ch${n}`;
    if (seen.has(id) || !title) return;
    seen.add(id);
    out.push({ id, title, startIndex: i });
  });
  return out;
}

export function titleFromText(pages: string[], fallback: string): string {
  const first = (pages.find((p) => p.trim()) ?? '').split('\n').find((l) => l.trim());
  const t = first?.trim() ?? '';
  return t.length >= 3 && t.length <= 80 ? t : fallback;
}

/** Deterministic 3-line extractive summary: the first three sentences of at least 5 words. */
export function extractiveSummary(pages: string[]): string {
  const text = pages.join(' ').replace(/\s+/g, ' ');
  const sentences = text.match(/[^.!?]+[.!?]/g) ?? [];
  const good = sentences.map((s) => s.trim()).filter((s) => s.split(' ').length >= 5);
  return good.slice(0, 3).join('\n') || text.slice(0, 240);
}

const SummarySchema = z.object({ summary: z.string().min(10).max(600) });

export async function summarize(
  llm: Llm | undefined,
  title: string,
  pages: string[],
): Promise<string> {
  const fallback = extractiveSummary(pages);
  if (!llm) return fallback;
  try {
    const r = await llm.json({
      model: 'fast',
      system:
        'Summarize a textbook chapter in at most 3 short lines for a router that picks which chapter answers a student question. Name the main topics and key terms. No fluff.',
      messages: `Chapter: ${title}\n\n${pages.join('\n\n').slice(0, 24000)}`,
      schema: SummarySchema,
      temperature: 0,
    });
    return r.summary.trim();
  } catch {
    return fallback;
  }
}

export async function buildChapter(
  llm: Llm | undefined,
  base: Pick<Chapter, 'courseId' | 'id' | 'title' | 'file'>,
  pages: string[],
  firstPage: number,
): Promise<Chapter> {
  return {
    ...base,
    summary: await summarize(llm, base.title, pages),
    pageStart: firstPage,
    pageEnd: firstPage + pages.length - 1,
  };
}

const POLICY_WORDS =
  /\b(homework|assignment|problem sets?|graded|collaborat|academic integrity|plagiari|AI\b|artificial intelligence|chatgpt|generative|late work|cheat)/i;

/** Verbatim lines of a syllabus that talk about homework, collaboration or AI use. */
export function extractPolicy(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const keep = lines.filter((l) => POLICY_WORDS.test(l));
  return keep.join('\n');
}

export async function ingestSyllabus(
  store: CourseStore,
  courseId: string,
  src: { text: string } | { path: string },
): Promise<string> {
  const text = 'text' in src ? src.text : await readFile(src.path, 'utf8');
  const policy = extractPolicy(text);
  const c = store.getCourse(courseId);
  store.saveCourse({ id: courseId, title: c?.title ?? courseId, policy: policy || text.trim() });
  return policy;
}

export function saveAllChapters(store: CourseStore, chapters: Chapter[]): void {
  for (const c of chapters) store.saveChapter(c);
}
