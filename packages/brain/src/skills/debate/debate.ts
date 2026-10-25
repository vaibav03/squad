import { z } from 'zod';
import type { Llm, LlmJsonRequest, RoomOutcome, StudentId } from '@squad/core';
import type { EmitEvent } from '../../mastery/types';
import {
  createCouncilRun,
  type CouncilMember,
  type Opinion,
  type Ranking,
  type Verdict,
} from '../../councils/council';
import { normaliseText } from '../../councils/pure';
import { splitPages, verifyQuoteOnPage } from '../../feynman/quote';

export const DEBATE_PROMPT_VERSION = 'debate-v1';
export const DEBATE_COUNCIL = 'debate';
export const DEBATE_NOT_GROUNDED =
  'General reasoning, not from your course materials (nothing relevant was found in them).';

export interface DebateMaterial {
  /** Chapter context joined with `[file p.N]` markers (what `ChapterProvider.chapterContext` returns). */
  context: string;
  chapter?: string;
}

export interface DebateVote {
  student: StudentId;
  side: 'pro' | 'con' | 'none';
}

export interface DebateDeps {
  llm: Llm;
  emit: EmitEvent;
}

export interface DebateInput {
  question: string;
  material?: DebateMaterial;
  /** Who votes: the group, or the single student. Empty means no vote. */
  students: readonly StudentId[];
  /**
   * Asks ONE student which side argued better, through the existing confirm card. Must resolve to
   * 'pro', 'con' or 'none' (timeout, no answer or an error). It never rejects.
   */
  askVote?: (
    student: StudentId,
    prompt: string,
    options: [string, string],
  ) => Promise<'pro' | 'con' | 'none'>;
  /** Called once both arguments are public and before the vote, so chat can show them. */
  onArguments?: (a: { pro: string; con: string; positions: Positions }) => Promise<void> | void;
}

export interface Positions {
  pro: string;
  con: string;
}

export interface DebateResult {
  positions: Positions;
  opinions: Opinion[];
  rankings: Ranking[];
  verdict: Verdict;
  /** 'pro' | 'con' | 'draw': the side the chair found stronger. */
  winner: 'pro' | 'con' | 'draw';
  votes: DebateVote[];
  tally: { pro: number; con: number; none: number };
  /** Verified `file p.N` citations used across both arguments. */
  citations: { file: string; page: number }[];
  grounded: boolean;
  usedFallback: boolean;
  outcome: RoomOutcome;
  /** Everything: question, both arguments, vote, verdict. */
  replyText: string;
  /** Vote, chair verdict, dissent and honesty notes (after the arguments were already shown). */
  closingText: string;
}

const PositionsSchema = z.object({ pro: z.string().min(1), con: z.string().min(1) });
const CiteSchema = z.object({ file: z.string(), page: z.coerce.number(), quote: z.string() });
const DebaterSchema = z.object({
  text: z.string(),
  answer: z.string().default(''),
  cite: CiteSchema.nullish(),
});
const ChairSchema = z.object({
  winner: z.enum(['pro', 'con', 'draw']),
  text: z.string(),
});

const clip = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`;
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** Fake/hallucinated citation markers are never allowed to survive in the model's own prose. */
const stripMarkers = (s: string): string =>
  s.replace(/\[[^\]]*\bp\.\s*\d+[^\]]*\]/g, '').replace(/\(\s*[^()]*\bp\.\s*\d+\s*\)/g, '');

export const MAX_MATERIAL_CHARS = 9000;

/** Keep the prompt small: at most MAX_MATERIAL_CHARS of the context, cut on a page boundary. */
export function trimMaterial(context: string, max = MAX_MATERIAL_CHARS): string {
  if (context.length <= max) return context;
  const pages = splitPages(context);
  if (pages.length === 0) return context.slice(0, max);
  let out = '';
  for (const p of pages) {
    const seg = `[${p.file} p.${p.page}]${p.text}`;
    if (out.length + seg.length > max) break;
    out += seg;
  }
  return out || `[${pages[0]!.file} p.${pages[0]!.page}]${pages[0]!.text.slice(0, max)}`;
}

/** Is this a "no credits / quota" style failure? Used only to label the fallback honestly. */
export function isCreditsError(e: unknown): boolean {
  return /\b(402|credits?|quota|billing|depleted|429|rate)\b/i.test(
    String((e as Error)?.message ?? e),
  );
}

const stockPositions = (): Positions => ({ pro: 'Yes, it holds', con: 'No, it does not hold' });
const stock = (side: 'pro' | 'con', pos: string): string =>
  side === 'pro'
    ? `The case for "${pos}": the main reasons point that way once the facts are laid out.`
    : `The case for "${pos}": the other side overlooks the costs and exceptions.`;

/** Parse a vote answer from the confirm card: the option text (or its number). */
export function parseVoteAnswer(answer: string, options: [string, string]): 'pro' | 'con' | 'none' {
  const a = normaliseText(answer);
  if (!a || a === 'timeout') return 'none';
  if (a === '1' || a === normaliseText(options[0])) return 'pro';
  if (a === '2' || a === normaliseText(options[1])) return 'con';
  return 'none';
}

export function tallyVotes(votes: readonly DebateVote[]) {
  const t = { pro: 0, con: 0, none: 0 };
  for (const v of votes) t[v.side] += 1;
  return t;
}

/** The side the room picked: majority, or null on a tie or no votes. */
export function roomPick(t: { pro: number; con: number }): 'pro' | 'con' | null {
  return t.pro === t.con ? null : t.pro > t.con ? 'pro' : 'con';
}

const voteWords = (t: { pro: number; con: number; none: number }): string =>
  t.pro + t.con === 0
    ? 'No votes were cast'
    : `${t.pro} for, ${t.con} against${t.none ? `, ${t.none} did not vote` : ''}`;

/**
 * Debate Stage: two experts argue opposite positions, the room votes through the confirm card, the
 * chair explains the stronger argument. Runs the generic council runner (`council:debate`), so the
 * village gets opinion, rank and verdict events (the verdict carries `outcome` and `dissent`).
 * Citations are verified in code: an argument only keeps a `[file p.N]` marker when its quote is on
 * that page of the supplied material.
 */
export async function runDebate(deps: DebateDeps, input: DebateInput): Promise<DebateResult> {
  const question = squash(input.question);
  const material = input.material?.context.trim()
    ? trimMaterial(input.material.context)
    : undefined;
  const grounded = material !== undefined;
  let usedFallback = false;
  let creditsDown = false;

  const note = (e: unknown) => {
    usedFallback = true;
    if (isCreditsError(e)) creditsDown = true;
  };

  // 1. The two opposite positions.
  let positions: Positions;
  try {
    positions = await deps.llm.json({
      model: 'fast',
      system: `You frame a classroom debate. Turn the question into two opposite, clearly different positions, each a short phrase (at most 12 words). [prompt ${DEBATE_PROMPT_VERSION}]`,
      messages: `Question: ${question}\n${grounded ? `Course material (stay within it):\n${material}\n` : ''}Return {"pro": position FOR, "con": position AGAINST}.`,
      schema: PositionsSchema,
      temperature: 0,
    });
    positions = { pro: clip(squash(positions.pro), 80), con: clip(squash(positions.con), 80) };
    if (normaliseText(positions.pro) === normaliseText(positions.con)) positions = stockPositions();
  } catch (e) {
    note(e);
    positions = stockPositions();
  }

  const verified: { side: 'pro' | 'con'; file: string; page: number }[] = [];
  const groundingRule = grounded
    ? 'Ground your argument in the course material below. Give ONE cite {file, page, quote} where quote is copied verbatim from that page. Do not invent facts or pages; if the material does not support your side, argue what it does support and say so.'
    : 'No course material applies. Argue from general reasoning, no citations. Return cite as null.';
  const members: CouncilMember[] = (['pro', 'con'] as const).map((side) => ({
    name: side,
    system: `You are ${side === 'pro' ? 'Pro' : 'Con'}, a debate expert. You argue ${side === 'pro' ? 'FOR' : 'AGAINST'} the question, holding the position "${positions[side]}". Make your single strongest argument in 2 or 3 plain sentences, then answer the other side's best point. Be fair and never insult anyone. ${groundingRule}`,
  }));

  const sideOf = (system: string): 'pro' | 'con' | undefined =>
    members.find((m) => system.includes(m.system))?.name as 'pro' | 'con' | undefined;

  /** Wraps the llm: debater JSON is checked in code (citations verified, fake markers stripped). */
  const guarded: Llm = {
    complete: (r) => deps.llm.complete(r),
    createCache: (r) => deps.llm.createCache(r),
    deleteCache: (h) => deps.llm.deleteCache?.(h) ?? Promise.resolve(),
    async json<T>(req: LlmJsonRequest<T>): Promise<T> {
      const side = sideOf(req.system ?? '');
      const isRanking = req.schema.safeParse({ order: [] }).success;
      if (isRanking || !side) {
        try {
          return await deps.llm.json(req);
        } catch (e) {
          note(e);
          return (isRanking ? { order: [] } : { text: '', answer: '' }) as T;
        }
      }
      let raw: z.infer<typeof DebaterSchema>;
      try {
        raw = await deps.llm.json({
          ...req,
          messages: `${typeof req.messages === 'string' ? req.messages : ''}${
            grounded ? `\n\nCourse material:\n${material}` : ''
          }\n\nAlso include "cite" (${grounded ? '{file, page, quote} copied from the material' : 'null'}). The "answer" field is your position in a few words.`,
          schema: DebaterSchema,
        } as LlmJsonRequest<z.infer<typeof DebaterSchema>>);
      } catch (e) {
        note(e);
        raw = { text: stock(side, positions[side]), answer: positions[side], cite: null };
      }
      let text = squash(stripMarkers(raw.text)) || stock(side, positions[side]);
      let marker = '';
      if (
        grounded &&
        raw.cite &&
        verifyQuoteOnPage(material, raw.cite.file, raw.cite.page, raw.cite.quote)
      ) {
        verified.push({ side, file: raw.cite.file, page: raw.cite.page });
        marker = ` [${raw.cite.file} p.${raw.cite.page}]`;
      }
      text = clip(text, 250 - marker.length) + marker;
      return { text, answer: squash(raw.answer) || positions[side] } as T;
    },
  };

  let votes: DebateVote[] = [];
  let outcome: RoomOutcome | undefined;
  let winner: 'pro' | 'con' | 'draw' = 'draw';

  const run = createCouncilRun({
    id: DEBATE_COUNCIL,
    members,
    chair: {
      name: 'chair',
      system: 'You are the chair. Say which argument was stronger and why, fairly, in plain words.',
    },
    task: `Debate question: ${question}\nPro position: ${positions.pro}\nCon position: ${positions.con}`,
    answerHint: 'your position in a few words',
    llm: guarded,
    emit: async (e) => {
      if (e.t === 'council.verdict' && outcome) await deps.emit({ ...e, outcome });
      else await deps.emit(e);
    },
    promptVersion: DEBATE_PROMPT_VERSION,
    decide: async ({ opinions, consensusOrder }) => {
      const tally = tallyVotes(votes);
      const room = roomPick(tally);
      const byMember = (n: string) => opinions.find((o) => o.member === n)?.text ?? '';
      let chairText = '';
      let w: 'pro' | 'con' | 'draw';
      try {
        const r = await deps.llm.json({
          model: 'chair',
          system: `You are the chair of a classroom debate. Decide which argument was stronger on its merits (evidence, logic, answering the other side), NOT by popularity, then explain why in one or two plain sentences. If the two are genuinely equal answer "draw". [prompt ${DEBATE_PROMPT_VERSION}]`,
          messages: `Question: ${question}\nPro (${positions.pro}): ${byMember('pro')}\nCon (${positions.con}): ${byMember('con')}\nDebaters ranked: ${consensusOrder.join(', ')}.\nReturn {"winner": "pro"|"con"|"draw", "text": your explanation}.`,
          schema: ChairSchema,
          temperature: 0,
        });
        w = r.winner;
        chairText = squash(stripMarkers(r.text));
      } catch (e) {
        note(e);
        w = room ?? 'draw';
        chairText = '';
      }
      winner = w;
      const label = w === 'draw' ? '' : positions[w];
      const explanation =
        chairText ||
        (w === 'draw'
          ? 'Both sides made fair points and neither pulled clearly ahead.'
          : `The case for "${label}" was a little stronger.`);
      const head = w === 'draw' ? 'Too close to call.' : `Stronger argument: ${label}.`;
      const verdictText = clip(`${head} ${explanation}`, 320);

      // The room disagreed with the chair: that is the dissent (the side the chair overruled).
      const dissenter = room !== null && w !== 'draw' && room !== w ? room : undefined;
      const dissentLine = dissenter
        ? clip(
            `The room voted for "${positions[dissenter]}" (${voteWords(tally)}); the chair weighed the arguments instead.`,
            240,
          )
        : w === 'draw' && room
          ? clip(`The room leaned to "${positions[room]}" (${voteWords(tally)}).`, 240)
          : undefined;

      const cites = [...new Map(verified.map((c) => [`${c.file}|${c.page}`, c])).values()];
      outcome = {
        title: clip(w === 'draw' ? 'Verdict: too close to call' : `Verdict: ${label}`, 120),
        summary: clip(explanation, 400),
        items: (['pro', 'con'] as const).map((s) => ({
          label: clip(`${s === 'pro' ? 'For' : 'Against'}: ${positions[s]}`, 120),
          detail: clip(byMember(s), 160),
        })),
        facts: [
          { label: 'Room vote', value: clip(voteWords(tally), 80) },
          { label: 'Chair picked', value: clip(w === 'draw' ? 'Neither (draw)' : label, 80) },
          { label: 'Grounding', value: grounded ? 'Your course materials' : 'General reasoning' },
        ],
        ...(dissentLine ? { dissent: dissentLine } : {}),
        why: opinions.map((o) => ({ who: o.member, text: clip(o.text, 280) })),
        notes: [
          ...(cites.length
            ? [
                clip(
                  `Cited and checked: ${cites.map((c) => `${c.file} p.${c.page}`).join(', ')}.`,
                  200,
                ),
              ]
            : []),
          ...(grounded ? [] : [DEBATE_NOT_GROUNDED]),
          ...(usedFallback
            ? [
                creditsDown
                  ? 'The model had no credits, so parts of this debate are template text (demo mode).'
                  : 'The model was unavailable for part of this debate, so some text is a template.',
              ]
            : []),
        ],
      };
      return { text: verdictText, answer: w, ...(dissenter ? { dissenter } : {}) };
    },
  });

  const opinions = await run.opinions();
  const rankings = await run.rankings();

  const pro = opinions.find((o) => o.member === 'pro')?.text ?? '';
  const con = opinions.find((o) => o.member === 'con')?.text ?? '';
  try {
    await input.onArguments?.({ pro, con, positions });
  } catch {
    /* chat display is best effort */
  }
  if (input.askVote && input.students.length) {
    const options: [string, string] = [
      clip(`For: ${positions.pro}`, 90),
      clip(`Against: ${positions.con}`, 90),
    ];
    const prompt = `Debate: ${clip(question, 160)}\nWhich side argued better?`;
    votes = await Promise.all(
      input.students.map(async (student) => ({
        student,
        side: await input.askVote!(student, prompt, options).catch(() => 'none' as const),
      })),
    );
  }
  const verdict = await run.verdict();
  const tally = tallyVotes(votes);
  const out = outcome!;
  const cites = [
    ...new Map(
      verified.map((c) => [`${c.file}|${c.page}`, { file: c.file, page: c.page }]),
    ).values(),
  ];

  const closing = [
    `${voteWords(tally)}.`,
    `Chair: ${verdict.text}`,
    ...(out.dissent ? [`Dissent: ${out.dissent}`] : []),
    ...(grounded ? [] : [DEBATE_NOT_GROUNDED]),
    ...(usedFallback
      ? ['(The model was unavailable for part of this, so some text is built-in demo text.)']
      : []),
  ];
  const replyText = [
    `Debate: ${clip(question, 140)}`,
    `For (${positions.pro}): ${pro}`,
    `Against (${positions.con}): ${con}`,
    ...closing,
  ].join('\n');

  return {
    positions,
    opinions,
    rankings,
    verdict,
    winner,
    votes,
    tally,
    citations: cites,
    grounded,
    usedFallback,
    outcome: out,
    replyText,
    closingText: closing.join('\n'),
  };
}
