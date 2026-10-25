import type { ContextSource } from './types';

/**
 * Port of Nook's canvas-answers (cubbie-re apps/mock/src/bridge/canvas-answers.ts): text-sized answers about the
 * viewer's synced Canvas data, produced before any LLM runs. Pure: the caller passes only sources the viewer may read.
 */
const DEADLINE_RE = /\b(due|deadlines?|assignments?|homework|hw|upcoming|to-?do)\b/i;
const FILES_RE = /\b(slides?|ppts?|pptx|powerpoints?|lecture notes|pdfs?|files?)\b/i;
const SLIDES_RE = /\b(slides?|ppts?|pptx|powerpoints?)\b/i;
const PDF_RE = /\b(pdfs?)\b/i;
const CANVAS_KINDS = new Set(['canvas_assignment', 'canvas_file', 'canvas_event']);

export const NOT_SYNCED = "I haven't synced your Canvas yet.";

export function fmtDue(ms: number | null | undefined, now: number): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'no due date';
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day} ${time} UTC${ms < now ? ' (past)' : ''}`;
}

const fileType = (s: ContextSource): 'ppt' | 'pdf' | null =>
  /\.(pptx?|key)$/i.test(s.title) ? 'ppt' : /\.pdf$/i.test(s.title) ? 'pdf' : null;

const CONNECTABLE_RE =
  /\b(canvas|google|drive|docs?|classroom|calendar|syllabus|assignments?|homework|hw\d*|due|deadlines?|slides?|lectures?|quiz(?:zes)?|exams?|midterms?|grades?|my courses?)\b/i;
/** True when the question is about content only a connected source could hold (Canvas, Drive, Calendar, coursework). */
export function isConnectableQuestion(text: string): boolean {
  return CONNECTABLE_RE.test(text) || isCanvasQuestion(text);
}

export function isCanvasQuestion(text: string): boolean {
  return FILES_RE.test(text) || DEADLINE_RE.test(text);
}

/** Returns a reply, or null when the text is not a Canvas question (caller falls through to the LLM). */
export function canvasAnswer(
  text: string,
  sources: ContextSource[],
  now: number,
  courseNames: ReadonlyMap<string, string> = new Map(),
): string | null {
  return canvasAnswerWithSources(text, sources, now, courseNames)?.text ?? null;
}

/** Same reply plus the synced sources it was built from (for citation chips). `used` is empty for the honest "not synced" reply. */
export function canvasAnswerWithSources(
  text: string,
  sources: ContextSource[],
  now: number,
  courseNames: ReadonlyMap<string, string> = new Map(),
): { text: string; used: ContextSource[] } | null {
  const wantsFiles = FILES_RE.test(text);
  const wantsDeadlines = DEADLINE_RE.test(text);
  if (!wantsFiles && !wantsDeadlines) return null;
  const canvas = sources.filter((s) => CANVAS_KINDS.has(s.kind));
  if (canvas.length === 0) return { text: NOT_SYNCED, used: [] };
  const courseOf = (id: string | null) => (id ? (courseNames.get(id) ?? '') : '');
  const suffix = (id: string | null) => (courseOf(id) ? ` (${courseOf(id)})` : '');

  if (
    wantsFiles &&
    !(wantsDeadlines && !/\b(slides?|ppts?|pptx|powerpoints?|pdfs?)\b/i.test(text))
  ) {
    const type = PDF_RE.test(text) ? 'pdf' : SLIDES_RE.test(text) ? 'ppt' : null;
    let files = canvas.filter((s) => s.kind === 'canvas_file' && (!type || fileType(s) === type));
    const named = [...courseNames].filter(
      ([, n]) => n && text.toLowerCase().includes(n.toLowerCase()),
    );
    if (named.length) files = files.filter((f) => named.some(([id]) => id === f.courseId));
    if (files.length === 0)
      return {
        text: type
          ? `No ${type === 'ppt' ? 'slides' : 'PDFs'} found in your synced Canvas files.`
          : 'No files found in your synced Canvas.',
        used: [],
      };
    files.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
    const lines = files
      .slice(0, 5)
      .map((f) => `- ${f.title}${suffix(f.courseId)}${f.url ? `\n  ${f.url}` : ''}`);
    return {
      text: `${files.length} file${files.length === 1 ? '' : 's'}${files.length > 5 ? ', latest 5' : ''}:\n${lines.join('\n')}`,
      used: files.slice(0, 5),
    };
  }

  const upcoming = canvas
    .filter((s) => s.kind === 'canvas_assignment')
    .filter((a) => a.dueAt === null || a.dueAt >= now - 24 * 3_600_000)
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  if (upcoming.length === 0) return { text: "Nothing due. You're all caught up.", used: [] };
  const lines = upcoming
    .slice(0, 5)
    .map((a) => `- ${a.title}${suffix(a.courseId)}: ${fmtDue(a.dueAt, now)}`);
  return {
    text: `Next ${Math.min(5, upcoming.length)} due:\n${lines.join('\n')}`,
    used: upcoming.slice(0, 5),
  };
}
