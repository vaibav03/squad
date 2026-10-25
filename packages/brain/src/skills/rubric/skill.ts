import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Attachment, Ctx, InboundMessage, Llm, OutboundMessage, Skill } from '@squad/core';
import type { EmitEvent } from '../../mastery/types';
import type { CourseStore } from '../../ingest/types';
import { extractPages } from '../../ingest/pdf';
import { isGradedGrab } from '../../experts/intent';
import { loadPrompt } from '../../experts/prompts';
import { isVerbatimLine } from '../hwpolicy';
import {
  RUBRIC_AGENT,
  RUBRIC_COUNCIL_ID,
  RUBRIC_DISCLAIMER,
  RubricLlmFeedbackSchema,
  RUBRIC_ROWS,
  RUBRIC_FILE,
  RUBRIC_PROMPT_VERSION,
  buildRubricOutcome,
  rubricClip,
  extractRubricFromText,
  findRubricPolicyLine,
  isRubricRequest,
  mapRubricCriteria,
  rubricMetWords,
  parseRubricRequest,
  sanitizeRubricRows,
  rubricSlug,
  type RubricRowCriteria,
  type RubricRowFeedback,
} from './rules';

export interface RubricSkillDeps {
  store: CourseStore;
  emit: EmitEvent;
  /** Falls back to `ctx.llm`. */
  llm?: Llm;
  courseIdFor?: (m: InboundMessage) => string;
  /** Injectable for attachments (default: node:fs). */
  readFile?: (path: string) => Promise<Uint8Array>;
  /** Injectable PDF text extractor (default: the ingest pdf extractor). */
  extractPdfText?: (bytes: Uint8Array) => Promise<string>;
  now?: () => number;
}

export const NO_RUBRIC_TEXT =
  'I couldn\'t find a rubric in your course materials. Paste it after "rubric:", one criterion per line, and ask again.';
export const NO_ANSWER_TEXT =
  'I need your answer to check. Paste it after "rubric check" or attach a photo or PDF of it.';
export const UNREADABLE_TEXT =
  "I couldn't read that attachment. Try a clearer photo or paste the text.";
export const MAX_ANSWER_CHARS = 8000;

const TranscriptSchema = z.object({ legible: z.boolean(), text: z.string().default('') });

async function transcribeImage(llm: Llm, a: Attachment, read: (p: string) => Promise<Uint8Array>) {
  const data = Buffer.from(await read(a.path)).toString('base64');
  const r = await llm.json({
    model: 'main',
    system: `You transcribe a student's written answer exactly as written. Transcribe exactly, do not correct, solve or comment. If the photo is unreadable set legible=false. [prompt ${RUBRIC_PROMPT_VERSION}]`,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Return {"legible": boolean, "text": string} with the full text.' },
          { type: 'image', mimeType: a.mime, data },
        ],
      },
    ],
    schema: TranscriptSchema,
    temperature: 0,
  });
  return r.legible ? r.text.trim() : '';
}

async function attachmentText(
  deps: RubricSkillDeps,
  llm: Llm,
  m: InboundMessage,
): Promise<string | undefined> {
  const a = m.attachments.find((x) => x.mime.startsWith('image/') || x.mime === 'application/pdf');
  if (!a) return undefined;
  const read = deps.readFile ?? ((p: string) => readFile(p));
  if (a.mime === 'application/pdf') {
    const bytes = await read(a.path);
    const extract =
      deps.extractPdfText ?? (async (b: Uint8Array) => (await extractPages(b)).join('\n').trim());
    return (await extract(bytes)).trim();
  }
  return transcribeImage(llm, a, read);
}

function findRubric(store: CourseStore, courseId: string): string[] {
  const course = store.getCourse(courseId);
  const fromPolicy = course?.policy ? extractRubricFromText(course.policy) : [];
  if (fromPolicy.length) return fromPolicy;
  for (const p of store.getPages(courseId)) {
    if (!RUBRIC_FILE.test(p.file)) continue;
    const got = extractRubricFromText(p.text);
    if (got.length) return got;
  }
  return [];
}

function rowsPrompt(mapped: RubricRowCriteria): string {
  return RUBRIC_ROWS.map(
    (r) =>
      `- ${r.key} (${r.label}): ${
        mapped[r.key].length
          ? mapped[r.key].join(' | ')
          : '(no separate rubric line; judge it in general)'
      }`,
  ).join('\n');
}

async function grade(
  llm: Llm,
  mapped: RubricRowCriteria,
  answer: string,
): Promise<RubricRowFeedback[]> {
  const task = loadPrompt(import.meta.url, 'rubric.task.md')
    .replace('{{rows}}', () => rowsPrompt(mapped))
    .replace('{{answer}}', () => answer);
  const fb = await llm.json({
    model: 'main',
    system: `${loadPrompt(import.meta.url, 'rubric.system.md')}\n[prompt ${RUBRIC_PROMPT_VERSION}]`,
    messages: task,
    schema: RubricLlmFeedbackSchema,
    temperature: 0.2,
  });
  return sanitizeRubricRows(fb, mapped, answer);
}

const rubricSays = (r: RubricRowFeedback) =>
  r.criteria.length ? r.criteria.join(' / ') : 'no separate line, checked in general';

export function formatRubricReply(
  rows: readonly RubricRowFeedback[],
  name: string,
  policyLine: string,
  grab: boolean,
): string {
  const n = rows.filter((r) => r.met).length;
  const out: string[] = [`Rubric check: ${name} (${rubricMetWords(n)} met, feedback only)`];
  for (const r of rows) {
    out.push('');
    out.push(`${r.label}: ${r.met ? 'Met' : 'Not yet'}`);
    out.push(`Rubric says: ${rubricSays(r)}`);
    out.push(r.comment);
    if (r.quotes[0]) out.push(`You wrote: "${r.quotes[0]}"`);
    out.push(`Next step: ${r.nextStep}`);
  }
  out.push('');
  out.push(RUBRIC_DISCLAIMER);
  if (grab)
    out.push("I can't write or fix the answer for you, but I can point at what to look at.");
  if (policyLine) out.push(`Course policy: "${policyLine}"`);
  return out.join('\n');
}

export function rubricUnavailableReply(criteria: readonly string[]): string {
  return [
    "The rubric checker is unavailable right now (demo mode), so I can't check your answer.",
    'You can self-check against the rubric yourself:',
    ...criteria.map((c, i) => `${i + 1}. ${c}`),
  ].join('\n');
}

export function createRubricSkill(deps: RubricSkillDeps): Skill {
  const course = deps.courseIdFor ?? (() => 'demo');
  const emit = async (e: Parameters<EmitEvent>[0]) => {
    try {
      await deps.emit(e);
    } catch {
      /* the village is optional */
    }
  };
  return {
    name: 'rubric',
    async match(m: InboundMessage) {
      return m.mentionsBot && isRubricRequest(m.text) ? 0.95 : 0;
    },
    async handle(m: InboundMessage, ctx: Ctx): Promise<OutboundMessage[]> {
      const reply = (text: string): OutboundMessage[] => [{ chatId: m.chatId, text }];
      const llm = deps.llm ?? ctx.llm;
      const req = parseRubricRequest(m.text);
      const courseId = course(m);

      let answer = req.answer;
      if (m.attachments.length) {
        try {
          const t = await attachmentText(deps, llm, m);
          if (t !== undefined) {
            if (!t) return reply(UNREADABLE_TEXT);
            answer = answer ? `${answer}\n${t}` : t;
          }
        } catch {
          return reply(
            m.attachments.some((a) => a.mime === 'application/pdf')
              ? UNREADABLE_TEXT
              : rubricUnavailableReply(
                  req.pasted.length ? req.pasted : findRubric(deps.store, courseId),
                ),
          );
        }
      }
      answer = answer.slice(0, MAX_ANSWER_CHARS).trim();
      if (!answer) return reply(NO_ANSWER_TEXT);

      const criteria = req.pasted.length ? req.pasted : findRubric(deps.store, courseId);
      if (!criteria.length) return reply(NO_RUBRIC_TEXT);
      const mapped = mapRubricCriteria(criteria);

      const policy = deps.store.getCourse(courseId)?.policy?.trim() ?? '';
      const found = policy ? findRubricPolicyLine(policy) : '';
      const policyLine = found && isVerbatimLine(found, policy) ? found : '';
      const grab = isGradedGrab(m.text);

      const student = m.from;
      await emit({ t: 'agent.state', agent: RUBRIC_AGENT, state: 'studying' });
      let rows: RubricRowFeedback[];
      try {
        rows = await grade(llm, mapped, answer);
      } catch {
        await emit({ t: 'agent.state', agent: RUBRIC_AGENT, state: 'idle' });
        return reply(rubricUnavailableReply(criteria));
      }

      const slug = rubricSlug(req.name);
      for (const [k, r] of rows.entries()) {
        await emit({
          t: 'council.opinion',
          councilId: RUBRIC_COUNCIL_ID,
          member: r.key,
          text: rubricClip(`${r.met ? 'Met' : 'Not yet'}. ${r.comment}`, 220),
        });
        await emit({
          t: 'quiz.result',
          quizId: `rubric:${slug}-${k + 1}`,
          chapter: `rubric:${slug}`,
          student,
          correct: r.met,
        });
      }
      const n = rows.filter((r) => r.met).length;
      await emit({
        t: 'council.verdict',
        councilId: RUBRIC_COUNCIL_ID,
        member: 'judge',
        text: rubricClip(
          `Rubric check: ${rubricMetWords(n)} criteria met. Feedback only, no grade.`,
          220,
        ),
        outcome: buildRubricOutcome(rows, req.name),
      });
      await emit({ t: 'agent.state', agent: RUBRIC_AGENT, state: 'idle' });
      return reply(formatRubricReply(rows, req.name, policyLine, grab));
    },
  };
}
