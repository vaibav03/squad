import { describe, expect, it } from 'vitest';
import { FakeLlm } from '@squad/core';
import { openMemoryDb } from '@squad/core/node';
import { createCourseStore, ingestText } from '../../ingest';
import {
  CLOSING_LINE,
  DEFAULT_QUESTIONS,
  INTRO_LINE,
  MAX_LINE_CHARS,
  ORAL_PROMPT_VERSION,
  classifyReply,
  clipLine,
  createOralExaminer,
  hasGrade,
  isExamableChapter,
  pickChapters,
  safeLine,
  scrubGrades,
  type ExaminerLine,
} from './index';

async function kit(llm: FakeLlm, files = ['ch1', 'ch2', 'ch3', 'ch4']) {
  const store = createCourseStore(openMemoryDb());
  for (const f of files)
    await ingestText(
      { store },
      'c',
      `${f}.pdf`,
      [`Text about topic ${f} that is long enough here.`],
      {
        chapter: f,
        title: `Topic ${f}`,
      },
    );
  const ex = createOralExaminer({ store, llm, courseId: 'c' }).begin({ student: 's_ana' });
  return { store, ex };
}
const isJudge = (req: unknown) => JSON.stringify(req).includes('Judge the');
const isSummary = (req: unknown) => JSON.stringify(req).includes('closing a spoken');
const llmFor = (opts: { vagueFirst?: boolean; summary?: unknown } = {}) => {
  let q = 0;
  let judged = 0;
  return new FakeLlm({
    fallback: (req) => {
      if (isSummary(req))
        return (
          opts.summary ?? {
            items: [0, 1, 2].map((index) => ({
              index,
              solid: 'You explained the core idea clearly.',
              revisit: 'Review the edge cases.',
            })),
          }
        );
      if (isJudge(req)) {
        judged++;
        const vague = opts.vagueFirst && judged === 1;
        return {
          complete: !vague,
          followUp: vague ? 'What happens in the boundary case?' : '',
          solid: 'The main idea was right.',
          revisit: 'The boundary cases.',
        };
      }
      return { question: `Why does idea number ${++q} matter in practice?` };
    },
  });
};
const texts = (l: ExaminerLine[]) => l.map((x) => x.text);
const ANSWER = 'I think it works by breaking the problem into smaller independent parts';

describe('pure helpers', () => {
  it('prompt version is set', () => expect(ORAL_PROMPT_VERSION).toMatch(/^oral v\d+$/));

  it('excludes exam and syllabus files', () => {
    expect(isExamableChapter({ id: 'ch1', file: 'ch1.pdf', title: 'Intro' })).toBe(true);
    expect(isExamableChapter({ id: 'midterm', file: 'midterm.pdf', title: 'Midterm' })).toBe(false);
    expect(isExamableChapter({ id: 'x', file: 'final-exam.pdf', title: 'x' })).toBe(false);
    expect(isExamableChapter({ id: 's', file: 'course.pdf', title: 'Course Syllabus' })).toBe(
      false,
    );
    expect(isExamableChapter({ id: 'e', file: 'examples.pdf', title: 'Examples' })).toBe(true);
  });

  it('picks chapters deterministically, round-robin, natural order', () => {
    const mk = (id: string) => ({
      courseId: 'c',
      id,
      title: id,
      summary: '',
      file: `${id}.pdf`,
      pageStart: 1,
      pageEnd: 1,
    });
    const cs = ['ch10', 'ch2', 'ch1', 'exam1'].map(mk);
    expect(pickChapters(cs).map((c) => c.id)).toEqual(['ch1', 'ch2', 'ch10']);
    expect(pickChapters([mk('a'), mk('b')], 3).map((c) => c.id)).toEqual(['a', 'b', 'a']);
    expect(pickChapters(cs, 3, 'ch2').map((c) => c.id)).toEqual(['ch2', 'ch2', 'ch2']);
    expect(pickChapters(cs, 3, 'nope')).toEqual([]);
    expect(pickChapters([], 3)).toEqual([]);
    expect(pickChapters(cs, 99)).toHaveLength(6);
  });

  it('classifies replies', () => {
    expect(classifyReply('')).toBe('empty');
    expect(classifyReply('  ...  ')).toBe('empty');
    expect(classifyReply('ok')).toBe('short');
    expect(classifyReply('Skip')).toBe('skip');
    expect(classifyReply('next question')).toBe('skip');
    expect(classifyReply('Repeat that')).toBe('repeat');
    expect(classifyReply('can you repeat that?')).toBe('repeat');
    expect(classifyReply("I don't know")).toBe('unsure');
    expect(classifyReply('no idea')).toBe('unsure');
    expect(classifyReply(ANSWER)).toBe('answer');
  });

  it('scrubs grades and numeric scoring', () => {
    for (const s of [
      'You scored 80%.',
      'That is 7/10.',
      '8 out of 10 overall.',
      'You would get a grade of B.',
      'A solid pass.',
      'Roughly 90 percent correct.',
      'You got 9 right.',
      'You got an A.',
      'You scored well on that.',
      'Your score of 7 is fine.',
      'Score: 7.',
      'That earns full marks.',
      'Your GPA would rise.',
    ])
      expect(hasGrade(s)).toBe(true);
    expect(scrubGrades('Good start. You scored 80%. Review loops.')).toBe(
      'Good start. Review loops.',
    );
    expect(safeLine('Nice. The answer is 42. Keep going.')).not.toMatch(/answer is/);
    expect(hasGrade('You explained recursion well.')).toBe(false);
    // disclaimers and ordinary prose that merely contain the word are not grades
    for (const s of [
      'Welcome to Oral Exam practice, feedback only: nothing here is graded.',
      'This is not graded and there is no grading.',
      'Good point about base cases.',
      'You got the idea of the base case.',
      'Mark the base case first.',
    ])
      expect(hasGrade(s), s).toBe(false);
    expect(hasGrade(INTRO_LINE)).toBe(false);
    expect(scrubGrades(INTRO_LINE)).toBe(INTRO_LINE);
  });

  it('clips to two sentences and 220 chars', () => {
    expect(clipLine('One. Two. Three.')).toBe('One. Two.');
    const long = clipLine(`${'word '.repeat(80)}end. Next.`);
    expect(long.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(clipLine('**Bold** `code`')).toBe('Bold code');
  });
});

describe('examiner state machine', () => {
  it('runs 3 questions, one follow-up max, then feedback-only summary and done', async () => {
    const llm = llmFor({ vagueFirst: true });
    const { ex } = await kit(llm);
    const g = await ex.greeting();
    expect(g[0]!.text).toBe(INTRO_LINE);
    expect(g[0]!.text).toContain('Oral Exam practice, feedback only');
    expect(g).toHaveLength(2);
    expect(g[1]!.cite).toMatchObject({ courseId: 'c', chapter: 'ch1' });
    expect(ex.done()).toBe(false);

    // vague first answer -> exactly one follow-up
    const f = await ex.reply(ANSWER);
    expect(texts(f)).toEqual(['What happens in the boundary case?']);
    // even if the judge kept saying "incomplete", a second answer moves on
    const q2 = await ex.reply(ANSWER);
    expect(q2).toHaveLength(1);
    expect(q2[0]!.cite?.chapter).toBe('ch2');
    const q3 = await ex.reply(ANSWER);
    expect(q3[0]!.cite?.chapter).toBe('ch3');
    expect(ex.done()).toBe(false);
    const end = await ex.reply(ANSWER);
    expect(ex.done()).toBe(true);
    expect(end.length).toBe(DEFAULT_QUESTIONS + 1);
    expect(end.at(-1)!.text).toBe(CLOSING_LINE);
    for (const l of end) {
      expect(l.text.length).toBeLessThanOrEqual(MAX_LINE_CHARS);
      expect(l.text).not.toMatch(/\d\s*%|percent|\d+\s*\/\s*\d+/i);
      expect(l.text).not.toMatch(/\b(grade|score)\b/i);
    }
    expect(end[0]!.text).toContain('Topic ch1');
    expect(await ex.reply('anything else')).toEqual([]);
  });

  it('follow-up limit holds when the judge always says incomplete', async () => {
    const llm = new FakeLlm({
      fallback: (req) =>
        isJudge(req)
          ? { complete: false, followUp: 'Can you say more?', solid: '', revisit: 'Revisit it.' }
          : isSummary(req)
            ? { items: [] }
            : { question: 'Why does this matter?' },
    });
    const { ex } = await kit(llm);
    await ex.greeting();
    const seen: string[] = [];
    for (let i = 0; i < 6 && !ex.done(); i++) seen.push(...texts(await ex.reply(ANSWER)));
    expect(ex.done()).toBe(true);
    expect(seen.filter((t) => t === 'Can you say more?')).toHaveLength(3); // one per question
  });

  it('summary scrubs digits-percent and leaked answers written by the LLM', async () => {
    const llm = llmFor({
      summary: {
        items: [
          { index: 0, solid: 'You scored 85% here.', revisit: 'The answer is 7.' },
          { index: 1, solid: 'Good grasp.', revisit: 'Revisit the edge cases.' },
          { index: 2, solid: 'A- work, 9/10.', revisit: 'Check definitions.' },
        ],
      },
    });
    const { ex } = await kit(llm);
    await ex.greeting();
    await ex.reply(ANSWER);
    await ex.reply(ANSWER);
    const end = await ex.reply(ANSWER);
    const all = texts(end).join(' ');
    expect(all).not.toMatch(/%|answer is|9\/10|scored/i);
    expect(all).toContain('Topic ch1');
    expect(ex.done()).toBe(true);
  });

  it('handles skip, repeat, unsure, empty and short replies in code', async () => {
    const llm = llmFor();
    const { ex } = await kit(llm);
    const g = await ex.greeting();
    const q1 = g[1]!.text;
    const callsBefore = llm.calls.length;
    expect(texts(await ex.reply('repeat that'))).toEqual([q1]);
    expect((await ex.reply('')).length).toBe(1); // reprompt
    expect(texts(await ex.reply('ok'))[0]).toMatch(/fine|practice/); // second short = unsure, advance
    expect(llm.calls.length).toBe(callsBefore + 1); // only the next question hit the LLM
    const sk = await ex.reply('skip');
    expect(sk[0]!.text).toMatch(/move on/);
    expect(sk).toHaveLength(2);
    const last = await ex.reply("I don't know");
    expect(ex.done()).toBe(true);
    expect(last.at(-1)!.text).toBe(CLOSING_LINE);
    expect(texts(last).join(' ')).toMatch(/Topic ch3/);
  });

  it('no chapters: says so honestly and is done', async () => {
    const { ex } = await kit(llmFor(), []);
    const g = await ex.greeting();
    expect(texts(g).join(' ')).toMatch(/cannot find any course chapters/);
    expect(ex.done()).toBe(true);
    expect(await ex.reply('hello there my friend')).toEqual([]);
  });

  it('only exam/syllabus files: counts as no chapters', async () => {
    const { ex } = await kit(llmFor(), ['midterm', 'syllabus']);
    await ex.greeting();
    expect(ex.done()).toBe(true);
  });

  for (const msg of ['boom', 'HTTP 402 credits depleted']) {
    it(`LLM failure (${msg}): deterministic fallback, no retries`, async () => {
      const llm = new FakeLlm({
        fallback: () => {
          throw new Error(msg);
        },
      });
      const { ex } = await kit(llm);
      const g = await ex.greeting();
      expect(g[1]!.text).toBe('Explain, in your own words, the main idea of Topic ch1.');
      expect(llm.calls).toHaveLength(1);
      const q2 = await ex.reply(ANSWER); // judge fails: no follow-up, next question
      expect(q2[0]!.text).toContain('Topic ch2');
      await ex.reply(ANSWER);
      const end = await ex.reply(ANSWER);
      expect(ex.done()).toBe(true);
      expect(texts(end).join(' ')).toMatch(/revisit Topic ch1, Topic ch2 and Topic ch3/);
      expect(end.at(-1)!.text).toBe(CLOSING_LINE);
      expect(llm.calls).toHaveLength(3 + 3 + 1); // 3 questions, 3 judgements, 1 summary, no retries
    });
  }

  it('a malformed LLM question falls back instead of speaking junk', async () => {
    const llm = new FakeLlm({ fallback: () => ({ question: 'The answer is 5. Grade: 90%.' }) });
    const { ex } = await kit(llm);
    const g = await ex.greeting();
    expect(g[1]!.text).toContain('Explain, in your own words');
  });

  it('given chapter: every question stays on it', async () => {
    const store = createCourseStore(openMemoryDb());
    for (const f of ['ch1', 'ch2'])
      await ingestText({ store }, 'c', `${f}.pdf`, ['Some text about the topic here ok.'], {
        chapter: f,
        title: f,
      });
    const ex = createOralExaminer({ store, llm: llmFor(), courseId: 'c' }).begin({
      student: 's',
      chapter: 'ch2',
    });
    const g = await ex.greeting();
    expect(g[1]!.cite?.chapter).toBe('ch2');
    expect((await ex.reply(ANSWER))[0]!.cite?.chapter).toBe('ch2');
  });
});
