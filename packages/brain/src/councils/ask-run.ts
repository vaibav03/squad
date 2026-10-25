import {
  COUNCIL_CONFIDENCE_WORDS,
  type CouncilConfidence,
  type CouncilMemberResult,
  type CouncilResult,
  type CouncilVerdict,
  type Llm,
  type RoomOutcome,
  type VillageEvent,
} from '@squad/core';
import { verifyClaims } from '../citations';
import { isGradedGrab, stripMention } from '../experts/intent';
import { BrainUnavailableError } from '../experts/errors';
import type { Brain, Claim } from '../experts/types';
import type { Page } from '../ingest/types';
import {
  ASK_COUNCIL_ID,
  ASK_MEMBERS,
  CHAIR_NAME,
  CHAIR_SYSTEM,
  GENERAL_RULES,
  OpinionSchema,
  RANK_TASK,
  RankSchema,
  TRIAGE_SYSTEM,
  TriageSchema,
  VerdictOutSchema,
  courseRules,
  memberSystem,
  type AskMember,
} from './ask-prompts';
import type { CouncilAskInput, CouncilEmit, CouncilLimits } from './ask-types';
import { aggregateRankings, normaliseText, repairOrder } from './pure';

export const COUNCIL_AGENT = `council:${ASK_COUNCIL_ID}`;
export const REFUSE_GRADED =
  "The council won't write graded work for you. Ask it which approach to use, or whether your reasoning holds, and it will weigh in.";
export const REFUSE_OFF_TOPIC =
  "That isn't a study question, so the council passes. Try a problem, a proof, a concept, or which approach to take.";
export const NOT_COVERED_NOTE = 'Not in the course materials, so this is general reasoning.';
const EVIDENCE_CHARS = 14000;

export interface RunDeps {
  llm: Llm;
  emit: CouncilEmit;
  brain?: Brain;
  courseId: string;
  now: () => number;
  limits: CouncilLimits;
  /** Called with a fresh copy after every change to the result. */
  publish(r: CouncilResult): void;
}

const cut = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}.`;
const firstSentence = (s: string): string => /^.*?[.!?](?:\s|$)/s.exec(s.trim())?.[0].trim() ?? s;
const list = (xs: string[]): string =>
  xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const nameKey = (s: string): string => s.trim().toLowerCase();

/** Runs `fn` with an AbortSignal that fires after `ms`; rejects on timeout. */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([fn(ac.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic seed for the anonymous label shuffle. */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Anonymise: stable per (run, ranker) shuffle of the others to labels A, B, C. Exported for tests. */
export function anonymise<T extends { member: string }>(
  runId: string,
  ranker: string,
  others: readonly T[],
): { label: string; item: T }[] {
  return [...others]
    .map((item) => ({ item, k: seedOf(`${runId}|${ranker}|${item.member}`) }))
    .sort((a, b) => a.k - b.k || a.item.member.localeCompare(b.item.member))
    .map((x, i) => ({ label: String.fromCharCode(65 + i), item: x.item }));
}

interface Gathered {
  mode: 'course' | 'general';
  evidence: string;
  pages: Page[];
  note?: string;
}

async function gather(d: RunDeps, question: string, courseId: string): Promise<Gathered> {
  if (!d.brain)
    return {
      mode: 'general',
      evidence: '',
      pages: [],
      note: 'No course materials are loaded, so this is general reasoning.',
    };
  try {
    const a = await withTimeout(() => d.brain!.ask(courseId, question), d.limits.callTimeoutMs);
    if (!a.grounded || a.chapters.length === 0)
      return { mode: 'general', evidence: '', pages: [], note: NOT_COVERED_NOTE };
    const pages = a.chapters.flatMap((c) => d.brain!.store.getPages(courseId, c));
    if (pages.length === 0)
      return { mode: 'general', evidence: '', pages: [], note: NOT_COVERED_NOTE };
    // Pages the verified answer cited come first, then the rest of the chapter, until the budget is used.
    const cited = new Set(a.citations.map((c) => `${c.file}#${c.page ?? 0}`));
    const ordered = [...pages].sort(
      (x, y) => Number(cited.has(`${y.file}#${y.page}`)) - Number(cited.has(`${x.file}#${x.page}`)),
    );
    let used = 0;
    const parts: string[] = [];
    for (const p of ordered) {
      if (used + p.text.length > EVIDENCE_CHARS && parts.length > 0) break;
      parts.push(`[${p.file} p.${p.page}]\n${p.text}`);
      used += p.text.length;
    }
    const facts = a.claims.map((c) => `- ${c.text} [${c.file} p.${c.page}]`).join('\n');
    const evidence = `${facts ? `Already verified from the materials:\n${facts}\n\n` : ''}${parts.join('\n\n')}`;
    return { mode: 'course', evidence, pages };
  } catch (e) {
    const why =
      e instanceof BrainUnavailableError ? 'were unavailable' : 'could not be checked in time';
    return {
      mode: 'general',
      evidence: '',
      pages: [],
      note: `The course materials ${why}, so this is general reasoning.`,
    };
  }
}

interface MemberOut {
  member: AskMember;
  result?: CouncilMemberResult;
}

export function emptyResult(
  id: string,
  input: CouncilAskInput,
  now: number,
  demo: boolean,
  visibility: 'squad' | 'private',
): CouncilResult {
  return {
    id: id as CouncilResult['id'],
    question: cut(input.question, 600),
    status: 'running',
    phase: 'opinions',
    grounding: 'none',
    notes: [],
    members: [],
    rankings: [],
    visibility,
    askedBy: input.askedBy,
    demo,
    startedAt: now,
  };
}

/** The whole run: triage, grounding, opinions, anonymous rankings, verdict. Never throws. */
export async function runAskCouncil(
  d: RunDeps,
  r: CouncilResult,
  input: CouncilAskInput,
): Promise<void> {
  const q = stripMention(input.question).trim() || input.question.trim();
  const priv = r.visibility === 'private';
  const deadline = r.startedAt + d.limits.runTimeoutMs;
  const safeEmit = async (e: VillageEvent): Promise<void> => {
    try {
      await d.emit(e);
    } catch (err) {
      console.warn(`[${COUNCIL_AGENT}] emit failed`, (err as Error).message);
    }
  };
  const change = (fn: (r: CouncilResult) => void): void => {
    fn(r);
    d.publish(r);
  };
  const finish = (status: CouncilResult['status'], message?: string): void =>
    change((x) => {
      x.status = status;
      x.phase = 'done';
      x.finishedAt = d.now();
      if (message) x.message = message;
    });
  const outOfTime = (): boolean => d.now() > deadline;
  let studying = false;
  const idle = async (): Promise<void> => {
    if (studying) await safeEmit({ t: 'agent.state', agent: COUNCIL_AGENT, state: 'idle' });
    studying = false;
  };

  try {
    // 1. triage: deterministic guards first, then one cheap model call (fails open).
    if (isGradedGrab(q)) return finish('refused', REFUSE_GRADED);
    try {
      const t = await withTimeout(
        (signal) =>
          d.llm.json({
            model: 'fast',
            system: TRIAGE_SYSTEM,
            messages: `Question: ${q}`,
            schema: TriageSchema,
            temperature: 0,
            signal,
          }),
        d.limits.callTimeoutMs,
      );
      if (!t.study) return finish('refused', REFUSE_OFF_TOPIC);
    } catch {
      // triage unavailable: let the council decide
    }

    await safeEmit({ t: 'agent.state', agent: COUNCIL_AGENT, state: 'studying' });
    studying = true;

    // 2. grounding
    const g = await gather(d, q, input.courseId ?? d.courseId);
    change((x) => {
      x.grounding = g.mode;
      if (g.note) x.notes.push(g.note);
    });

    // 3. opinions: parallel calls, events released in member order
    const system = (m: AskMember): string =>
      memberSystem(m, g.mode === 'course' ? courseRules(g.evidence) : GENERAL_RULES);
    const task = `Question from a student:\n${q}\n\nReply JSON {"answer": short committed answer, "position": your reasoning in at most 4 sentences${g.mode === 'course' ? ', "claims": [{"text","file","page","quote"}]' : ''}}.`;
    const runMember = async (m: AskMember): Promise<MemberOut> => {
      try {
        const out = await withTimeout(
          (signal) =>
            d.llm.json({
              model: 'main',
              system: system(m),
              messages: task,
              schema: OpinionSchema,
              temperature: 0.4,
              signal,
            }),
          d.limits.callTimeoutMs,
        );
        const claims: Claim[] = g.mode === 'course' ? out.claims : [];
        const { verified, struck } = verifyClaims(claims, g.pages);
        const seen = new Set<string>();
        const citations = verified
          .filter((c) => !seen.has(`${c.file}#${c.page}`) && seen.add(`${c.file}#${c.page}`))
          .slice(0, 8)
          .map((c) => ({ file: c.file, page: c.page, label: `${c.file} p.${c.page}` }));
        const cited = verified.map((c) => `${c.text.trim()} [${c.file} p.${c.page}]`).join(' ');
        const position = out.position.trim();
        const text =
          g.mode === 'course'
            ? [position, cited].filter(Boolean).join(' ')
            : position || out.answer.trim();
        if (!text && !out.answer.trim()) throw new Error('empty opinion');
        return {
          member: m,
          result: {
            id: m.id,
            name: m.name,
            stance: m.stance,
            status: 'answered',
            text: cut(text || out.answer.trim(), 1400),
            answer: cut(out.answer.trim() || firstSentence(position), 240),
            citations,
            struck: struck.length,
          },
        };
      } catch {
        return { member: m };
      }
    };
    const settled = ASK_MEMBERS.map((m) => runMember(m));
    const outs: MemberOut[] = [];
    for (const p of settled) {
      const o = await p;
      outs.push(o);
      const res: CouncilMemberResult = o.result ?? {
        id: o.member.id,
        name: o.member.name,
        stance: o.member.stance,
        status: 'failed',
        text: '',
        answer: '',
        citations: [],
        struck: 0,
      };
      change((x) => void x.members.push(res));
      if (o.result)
        await safeEmit({
          t: 'council.opinion',
          councilId: COUNCIL_AGENT,
          member: o.member.name,
          ...(priv ? {} : { text: o.result.text }),
        });
    }
    const answered = outs.filter((o) => o.result).map((o) => o.result!);
    const failed = outs.filter((o) => !o.result).map((o) => o.member.name);
    if (failed.length > 0)
      change((x) =>
        x.notes.push(
          `${list(failed)} did not answer in time, so ${answered.length} member${answered.length === 1 ? '' : 's'} voted.`,
        ),
      );
    if (g.mode === 'course') {
      const bare = answered.filter((a) => a.citations.length === 0).map((a) => a.name);
      if (bare.length > 0)
        change((x) => void x.notes.push(`${list(bare)} gave no verified citation.`));
    }
    if (answered.length < 2) {
      await idle();
      return finish(
        'failed',
        'The council could not meet quorum just now. Try again in a minute, or ask your TA.',
      );
    }
    if (outOfTime()) {
      await idle();
      return finish('failed', 'The council ran out of time. Try again in a minute.');
    }

    // 4. rankings: anonymous labels, order only; trivial with two members
    change((x) => void (x.phase = 'rankings'));
    const names = answered.map((a) => a.name);
    const rankOne = async (a: CouncilMemberResult): Promise<string[] | undefined> => {
      const others = answered.filter((o) => o.name !== a.name).map((o) => ({ member: o.name, o }));
      const otherNames = others.map((o) => o.member);
      if (others.length === 1) return otherNames;
      const labelled = anonymise(r.id, a.name, others);
      try {
        const out = await withTimeout(
          (signal) =>
            d.llm.json({
              model: 'main',
              system: memberSystem(
                ASK_MEMBERS.find((m) => m.name === a.name)!,
                'You are now judging anonymous responses. Judge the reasoning only.',
              ),
              messages: `Question: ${q}\n\n${labelled
                .map((l) => `Response ${l.label}: ${l.item.o.text}\n(answer: ${l.item.o.answer})`)
                .join('\n\n')}\n\n${RANK_TASK}`,
              schema: RankSchema,
              temperature: 0,
              signal,
            }),
          d.limits.callTimeoutMs,
        );
        const byLabel = new Map(labelled.map((l) => [l.label, l.item.member]));
        const mapped = out.order
          .map((x) =>
            byLabel.get(
              x
                .trim()
                .replace(/^response\s+/i, '')
                .toUpperCase(),
            ),
          )
          .filter((x): x is string => x !== undefined);
        return repairOrder(mapped, otherNames);
      } catch {
        return undefined;
      }
    };
    const orders = await Promise.all(answered.map((a) => rankOne(a)));
    const ranked: { member: string; order: string[] }[] = [];
    for (let i = 0; i < answered.length; i++) {
      const order = orders[i];
      if (!order) continue;
      const entry = { member: answered[i]!.name, order };
      ranked.push(entry);
      change((x) => void x.rankings.push(entry));
      await safeEmit({
        t: 'council.rank',
        councilId: COUNCIL_AGENT,
        member: entry.member,
        order: entry.order,
      });
    }
    const consensus = ranked.length > 0 ? aggregateRankings(ranked, names) : names;
    if (ranked.length < answered.length && answered.length > 2)
      change((x) => void x.notes.push('Some peer rankings were unavailable.'));
    if (outOfTime()) {
      await idle();
      return finish('failed', 'The council ran out of time. Try again in a minute.');
    }

    // 5. verdict
    change((x) => void (x.phase = 'verdict'));
    const verdict = await decide();
    async function decide(): Promise<CouncilVerdict> {
      const top = answered.find((a) => a.name === consensus[0]) ?? answered[0]!;
      let chairNote: string | undefined;
      let out: ReturnType<typeof VerdictOutSchema.parse> | undefined;
      try {
        out = await withTimeout(
          (signal) =>
            d.llm.json({
              model: 'chair',
              system: CHAIR_SYSTEM,
              messages: `Question: ${q}\n\nGrounding: ${g.mode === 'course' ? 'the members cited verified course pages' : 'general reasoning, the course materials do not cover this'}\nPeer ranking, best first: ${consensus.join(', ')}\n\n${answered
                .map((a) => `${a.name} (${a.stance}): ${a.text}\n(answer: ${a.answer})`)
                .join(
                  '\n\n',
                )}\n\nReply JSON {"verdict", "answer", "agreeing": [member names], "dissentWhy", "confidence": "confident"|"fairly_sure"|"uncertain", "next"}.`,
              schema: VerdictOutSchema,
              temperature: 0,
              signal,
            }),
          d.limits.callTimeoutMs,
        );
      } catch {
        chairNote = `The chair did not respond, so this is the top-ranked answer (${top.name}).`;
      }
      const nameOf = new Map(answered.map((a) => [nameKey(a.name), a.name]));
      const verdictAnswer = out?.answer.trim() || top.answer;
      let agreeing = (out?.agreeing ?? [])
        .map((n) => nameOf.get(nameKey(n)))
        .filter((n): n is string => n !== undefined);
      if (agreeing.length === 0)
        agreeing = answered
          .filter((a) => normaliseText(a.answer) === normaliseText(verdictAnswer))
          .map((a) => a.name);
      if (!out) agreeing = [top.name];
      const dissenters = answered.filter((a) => !agreeing.includes(a.name));
      const dis = dissenters[0];

      // confidence: the chair's word, capped by what the evidence supports
      const rank: CouncilConfidence[] = ['uncertain', 'fairly_sure', 'confident'];
      let cap: CouncilConfidence = 'confident';
      let note: string;
      if (!out) {
        cap = 'uncertain';
        note = 'The chair was unavailable.';
      } else if (dissenters.length >= 2) {
        cap = 'uncertain';
        note = 'The council split three ways.';
      } else if (dis && consensus[0] === dis.name) {
        cap = 'uncertain';
        note = `${dis.name}, the top-ranked member, disagreed with the verdict.`;
      } else if (dis) {
        cap = 'fairly_sure';
        note = `${agreeing.length} of ${answered.length} agreed; ${dis.name} saw it differently.`;
      } else if (answered.length < ASK_MEMBERS.length) {
        cap = 'fairly_sure';
        note = `Both members who answered agreed (${list(failed)} did not answer).`;
      } else {
        note = 'All three members agreed.';
      }
      const chairWord = out?.confidence ?? 'uncertain';
      const confidence = rank[Math.min(rank.indexOf(cap), rank.indexOf(chairWord))]!;
      const uncertain = confidence === 'uncertain';
      let next = (out?.next ?? '').trim();
      if (!next)
        next =
          g.mode === 'course'
            ? 'Check the cited pages yourself, then try the problem on your own.'
            : 'Try it on a small example yourself to check.';
      if (uncertain && !/\bTA\b/.test(next))
        next = `${next} Check this with your TA before relying on it.`;
      const text = (out?.verdict ?? '').trim() || top.text;
      return {
        chair: CHAIR_NAME,
        text: cut(text, 1400),
        answer: cut(verdictAnswer, 240),
        confidence,
        confidenceNote: [note, chairNote].filter(Boolean).join(' '),
        uncertain,
        ...(dis
          ? {
              dissent: {
                member: dis.name,
                view: cut(`${dis.answer}. ${firstSentence(dis.text)}`.replace(/\.\.$/, '.'), 600),
                why: cut(
                  (out?.dissentWhy ?? '').trim() ||
                    `The chair weighed the other answers more heavily.`,
                  400,
                ),
              },
            }
          : {}),
        next: cut(next, 400),
      };
    }

    change((x) => {
      x.verdict = verdict;
      x.status = 'done';
      x.phase = 'done';
      x.finishedAt = d.now();
    });
    await safeEmit({
      t: 'council.verdict',
      councilId: COUNCIL_AGENT,
      member: CHAIR_NAME,
      ...(priv ? {} : { text: verdict.text, outcome: outcomeOf(r, verdict) }),
      dissent: verdict.dissent !== undefined,
      ...(verdict.dissent ? { dissenter: verdict.dissent.member } : {}),
    });
    await idle();
  } catch (e) {
    console.warn(`[${COUNCIL_AGENT}] run failed`, (e as Error).message);
    await idle();
    if (r.status === 'running')
      finish('failed', 'The council hit a problem and stopped. Try again in a minute.');
  }
}

/** RoomOutcome for the village card: public words only. */
export function outcomeOf(r: CouncilResult, v: CouncilVerdict): RoomOutcome {
  const title = cut(v.answer || firstSentence(v.text), 120);
  const notes = [v.next, ...r.notes].map((n) => cut(n, 200)).slice(0, 6);
  return {
    title,
    summary: cut(v.text, 400),
    items: [],
    facts: [
      { label: 'Confidence', value: COUNCIL_CONFIDENCE_WORDS[v.confidence] },
      {
        label: 'Sources',
        value: r.grounding === 'course' ? 'Course materials' : 'General reasoning',
      },
    ],
    ...(v.dissent
      ? { dissent: cut(`${v.dissent.member}: ${v.dissent.view} ${v.dissent.why}`, 240) }
      : {}),
    why: r.members
      .filter((m) => m.status === 'answered')
      .slice(0, 6)
      .map((m) => ({ who: m.name, text: cut(m.answer || m.text, 280) })),
    notes,
  };
}
