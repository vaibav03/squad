// The shared study plan: squad-scoped, versioned, one object the group chat, the web panel and the nudges all read.
// Every method returns what the group chat should say (`say`); REST callers post it, the chat skill returns it.
import { randomBytes } from 'node:crypto';
import { citationLabel } from '@squad/bot';
import {
  planBadge,
  planCountdownWords,
  planProgressWords,
  type ChatCard,
  type ChatCitation,
  type PlanGenerator,
  type ProvenanceHint,
  type Plan,
  type PlanItem,
  type PlanItemPatch,
  type PlanMember,
  type PlanView,
  plural,
} from '@squad/core';
import type { HubDeps, Viewer } from '../types';
import {
  addDays,
  daysBetween,
  editItem,
  fieldsOf,
  generateItems,
  isRealDate,
  matchItems,
  parseExamDate,
  rebalance,
  resolveConflict,
  ymd,
  type ContextDueLite,
  type DueLite,
  type PlanChapter,
} from './logic';
import type { PlanStore } from './store';
import { PlannerError, type PlanPlanner, type PlannerContextItem } from './planner';

/** Where plan inputs come from. The default reads the course store, due items and mastery; a context store can replace it. */
export interface PlanContext {
  defaultCourse(): string;
  courseTitle(courseId: string): string;
  chapters(courseId: string): PlanChapter[];
  /** PRIVATE per student: chapter -> Leitner box. */
  boxes(studentId: string, courseId: string): Map<string, number>;
  /** PRIVATE per student: busy `YYYY-MM-DD` days (never titles). */
  busyDays(studentId: string): Set<string>;
  /** Course-wide due items only (never one student's calendar). */
  due(courseId: string, from: number, to: number): DueLite[];
  /** Members' imported Canvas / Google Classroom due dates (title only when its owner shared it with the squad). */
  contextDue?(squadId: string, memberIds: string[], from: number, to: number): ContextDueLite[];
  /** Text of one course page (the planner's quotes are checked against it). */
  pageText?(courseId: string, file: string, page: number): string | undefined;
  /** Canvas/Google items the viewer may read (own and squad-shared), through the context store's read gate. */
  contextItems?(v: Viewer, courseId: string): PlannerContextItem[];
  /** "Plan from this answer": the viewer's own sources named by id, as due items with titles (the answer already showed them to the squad). */
  contextRefs?(v: Viewer, ids: string[]): ContextDueLite[];
}

export interface PlanNudgeHook {
  /** Called after every change so DM nudges follow the plan (scheduler is optional). */
  sync(plan: Plan): void;
}

export interface PlanSay {
  text: string;
  card?: ChatCard;
  /** Verified material the plan was built from (agent plans), shown as chips. */
  citations?: ChatCitation[];
  /** What the plan says about itself when it has no citations (the fallback plan). */
  provenance?: ProvenanceHint;
}
export type PlanOk = { ok: true; plan: Plan; say: PlanSay; conflictId?: string };
export type PlanFail = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 422 | 500;
  code: string;
  message: string;
  plan?: Plan;
  conflictId?: string;
  say?: PlanSay;
};
export type PlanResult = PlanOk | PlanFail;

export interface PlanService {
  store: PlanStore;
  propose(
    v: Viewer,
    body: { courseId?: string; examDate?: string; examLabel?: string; text?: string; contextSourceIds?: string[] },
  ): Promise<PlanResult>;
  respond(v: Viewer, planId: string, r: 'accept' | 'decline'): PlanResult;
  /**
   * Adds ONE new item (the viewer's own, e.g. a council action item) to the squad's current open plan. A new item
   * cannot collide with another edit, so it never conflicts; a closed plan or a non-member is refused, and the plan
   * `rev` bumps like any accepted change. Group acceptance is untouched: the item is the adder's own work, so
   * nobody's load changes and nobody has to re-accept. An item with the same title on the plan is not added twice.
   */
  addItem(v: Viewer, item: { title: string; detail?: string; source?: string }): PlanResult;
  edit(
    v: Viewer,
    planId: string,
    itemId: string,
    baseRev: number,
    patch: PlanItemPatch,
  ): PlanResult;
  editByRef(v: Viewer, ref: string, to: string): PlanResult;
  resolve(v: Viewer, planId: string, conflictId: string, pick: 'theirs' | 'mine'): PlanResult;
  confirm(v: Viewer, planId: string): PlanResult;
  cancel(v: Viewer, planId: string): PlanResult;
  done(v: Viewer, planId: string, itemId: string, done: boolean): PlanResult;
  doneByRef(v: Viewer, ref: string): PlanResult;
  /** The plan the viewer's squad is working on (or its newest closed one). */
  current(v: Viewer): Plan | undefined;
  get(v: Viewer, planId: string): Plan | undefined;
  view(v: Viewer, p: Plan): PlanView;
  /** Plain text status for chat (group-safe; never private data). */
  summary(p: Plan): string;
  /** The viewer's own private lines (busy overlap, weak topics) for a DM. */
  privateNote(v: Viewer, p: Plan): string;
  /** Post a plain bot message into the squad group chat; mirrors to iMessage through the chat hub. */
  post(squadId: string, say: PlanSay): void;
  /** Would this text address an open plan item of this viewer? (cheap, used by chat routing) */
  hasOpen(v: Viewer): { proposed: boolean; pendingMe: boolean; active: boolean };
  matchOwnOpen(v: Viewer, ref: string): PlanItem[];
  setNudges(h: PlanNudgeHook | undefined): void;
  /** The planner agent. Without one (no key) the labelled fallback generator builds the plan. */
  setPlanner(p: PlanPlanner | undefined): void;
  /** The chips or label the plan's chat message carries. */
  provenanceOf(p: Plan): Pick<PlanSay, 'citations' | 'provenance'>;
  onChange(fn: (p: Plan, ev: string) => void): () => void;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d: string): string =>
  `${MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const id10 = () => randomBytes(8).toString('hex').slice(0, 10);

export const REPLY_HELP =
  'Reply "@nook plan 1" to accept, "plan 2" to decline, "plan 3 <item> to <person or date>" to change an item, "plan 4" if you are the organizer to start it now, and "done <item>" when you finish one.';

export function createPlanService(
  deps: Pick<HubDeps, 'db' | 'directory' | 'chat' | 'now' | 'log' | 'ports' | 'runtime'> &
    Partial<Pick<HubDeps, 'imessageSync'>>,
  ctx: PlanContext,
  store: PlanStore,
): PlanService {
  let nudges: PlanNudgeHook | undefined;
  let planner: PlanPlanner | undefined;
  const listeners = new Set<(p: Plan, ev: string) => void>();
  const nameOf = (id: string) => deps.directory.student(id)?.name ?? id;

  const emitChange = (p: Plan, ev: string) => {
    try {
      nudges?.sync(p);
    } catch (e) {
      deps.log.error('plan nudges sync failed', { err: (e as Error).name });
    }
    for (const fn of [...listeners])
      try {
        fn(p, ev);
      } catch {
        /* listener errors never break a plan write */
      }
  };
  const provenanceOf = (p: Plan): Pick<PlanSay, 'citations' | 'provenance'> => {
    if (p.generator.kind === 'agent') {
      const citations = p.citations
        .filter((c) => c.kind === 'material' && c.file && c.page)
        .map((c) => ({ file: c.file!, page: c.page!, label: citationLabel(c.file!, c.page!) }));
      return citations.length ? { citations } : { provenance: { kind: 'no_sources' } };
    }
    const badge = planBadge(p.generator);
    return {
      provenance: {
        kind: 'sample',
        label: `${badge.kindLabel}: scripted, not written by an agent${p.generator.reason ? ` (${p.generator.reason})` : ''}`,
      },
    };
  };
  const cardOf = (p: Plan): ChatCard => ({
    type: 'plan',
    planId: p.id,
    rev: p.rev,
    status: p.status,
  });
  const llmReal = () => deps.runtime?.llm().llm === 'real';
  const portsReal = () => deps.runtime?.ports() === 'real';
  /** Why the live model is not answering, in a few plain words. */
  const llmReason = () => deps.runtime?.llm().reason ?? 'no Gemini key';
  const log = (p: Plan, by: string, text: string) => {
    p.log.push({ ts: deps.now(), by, text });
    if (p.log.length > 200) p.log.splice(0, p.log.length - 200);
    p.updatedAt = deps.now();
  };
  /** How the last plan message is doing on the iMessage side, from its stored delivery state. */
  const imessageStateOf = (messageId: string): PlanView['sync']['imessage'] => {
    const st = deps.chat.store.get(messageId)?.deliveryState?.state;
    if (st) return st;
    return deps.imessageSync ? 'web_only' : 'off';
  };
  const own = (v: Viewer, p: Plan | undefined): p is Plan => !!p && p.squadId === v.squadId;
  const fail = (
    status: PlanFail['status'],
    code: string,
    message: string,
    extra: Partial<PlanFail> = {},
  ): PlanFail => ({ ok: false, status, code, message, ...extra });
  const open = (p: Plan) => p.status === 'proposed' || p.status === 'active';
  const lines = (p: Plan): string =>
    p.members
      .filter((m) => m.optedIn)
      .map((m) => {
        const mine = p.items.filter((i) => i.ownerId === m.id);
        return `${m.name}: ${mine.map((i) => `${i.chapter ?? i.title} (${fmtDate(i.date)})`).join(', ') || 'nothing this round'}`;
      })
      .join('\n');
  const countsOf = (p: Plan) => {
    const accepted = p.members.filter((m) => m.optedIn && m.response === 'accepted').length;
    const total = p.members.filter((m) => m.optedIn).length;
    return { accepted, total };
  };
  const examWords = (p: Plan, now: number) =>
    p.examDate
      ? `${p.examLabel} on ${fmtDate(p.examDate)} (${planCountdownWords(daysBetween(ymd(now), p.examDate))})`
      : 'no exam date yet';

  function summary(p: Plan): string {
    const { accepted, total } = countsOf(p);
    const done = p.items.filter((i) => i.status === 'done').length;
    const head =
      p.status === 'proposed'
        ? `Study plan (proposed, ${accepted} of ${total} accepted), ${examWords(p, deps.now())}.`
        : p.status === 'active'
          ? `Study plan (active), ${examWords(p, deps.now())}. ${planProgressWords(done, p.items.length)}.`
          : p.status === 'failed'
            ? `Study plan could not be built: ${p.error ?? 'unknown error'}.`
            : 'The study plan was cancelled.';
    const open = p.conflicts.filter((c) => c.status === 'open');
    const cf = open.length
      ? `\n${open.length} edit conflict${open.length === 1 ? '' : 's'} waiting for a pick in the village Study plan.`
      : '';
    return `${head}\n${lines(p)}${cf}`;
  }

  function post(squadId: string, say: PlanSay): void {
    deps.chat.postBot({
      chatId: `group:${squadId}`,
      personaId: 'cubbie',
      personaName: 'Nook',
      emoji: '🐻',
      text: say.text,
      citations: say.citations ?? [],
      attachments: [],
      ...(say.card ? { card: say.card } : {}),
      ...(say.provenance ? { provenance: say.provenance } : {}),
    });
  }

  function activateIfReady(p: Plan, by: string, reason: string): boolean {
    if (p.status !== 'proposed') return false;
    const m = p.members.filter((x) => x.optedIn);
    if (m.length === 0 || !m.every((x) => x.response === 'accepted')) return false;
    p.status = 'active';
    p.rev += 1;
    log(p, by, `plan active (${reason})`);
    return true;
  }

  // Remember the last plan message posted to the squad chat so the panel can say where the decision went.
  deps.chat.onBotPost((m) => {
    if (m.card?.type !== 'plan' || !m.chatId.startsWith('group:')) return;
    const p = store.get(m.card.planId);
    if (!p) return;
    p.posted = { messageId: m.id, at: m.ts, text: m.text.replace(/\s+/g, ' ').slice(0, 140) };
    store.save(p);
  });

  const service: PlanService = {
    store,
    setNudges: (h) => void (nudges = h),
    setPlanner: (p) => void (planner = p),
    provenanceOf,
    onChange(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    post,
    summary,
    current(v) {
      const c = store.current(v.squadId);
      return c ?? store.list(v.squadId)[0];
    },
    get(v, id) {
      const p = store.get(id);
      return own(v, p) ? p : undefined;
    },
    hasOpen(v) {
      const p = store.current(v.squadId);
      const me = p?.members.find((m) => m.id === v.studentId);
      return {
        proposed: p?.status === 'proposed',
        pendingMe: p?.status === 'proposed' && me?.response === 'pending',
        active: p?.status === 'active',
      };
    },
    matchOwnOpen(v, ref) {
      const p = store.current(v.squadId);
      if (!p) return [];
      return matchItems(
        p.items.filter((i) => i.ownerId === v.studentId && i.status === 'todo'),
        ref,
      );
    },

    async propose(v, body) {
      const now = deps.now();
      const prior = store.current(v.squadId);
      if (prior && prior.organizerId !== v.studentId)
        return fail(409, 'plan_exists', `${nameOf(prior.organizerId)} already started a plan.`, {
          plan: prior,
          say: { text: `There is already a plan going.\n${summary(prior)}`, card: cardOf(prior) },
        });
      const members = deps.directory.members(v.squadId);
      if (!members.some((m) => m.id === v.studentId))
        return fail(403, 'forbidden', 'Not in a squad.');
      // course: asked for, else the default, else the first ready course that has chapters
      let courseId = body.courseId;
      if (!courseId) {
        const cands = [ctx.defaultCourse()];
        try {
          const l = await deps.ports.brain.listCourses(v.studentId);
          cands.push(...l.filter((c) => c.status === 'ready').map((c) => c.courseId));
        } catch {
          /* the default course is still tried */
        }
        courseId = cands.find((c) => ctx.chapters(c).length > 0) ?? cands[0]!;
      }
      const chapters = ctx.chapters(courseId);
      if (chapters.length === 0)
        return fail(
          422,
          'no_materials',
          'I have no course chapters to plan from yet. Add course material first, then ask again.',
        );
      const today = ymd(now);
      let examDate: string | null = body.examDate ?? null;
      let examLabel = body.examLabel ?? 'Exam';
      const horizon = now + 120 * 86_400_000;
      const dueAll = ctx.due(courseId, now, horizon);
      if (!examDate) {
        const exam = dueAll.find((d) => d.kind === 'exam');
        if (exam) {
          examDate = ymd(exam.dueAt);
          examLabel = exam.title;
        }
      }
      if (examDate && !isRealDate(examDate))
        return fail(422, 'invalid_date', 'That is not a real date.');
      if (examDate && examDate <= today)
        return fail(
          422,
          'exam_in_past',
          `${fmtDate(examDate)} is not in the future. Give me the exam date again, for example "for the exam on ${fmtDate(addDays(today, 14))}".`,
        );
      if (examDate && daysBetween(today, examDate) > 120)
        return fail(
          422,
          'exam_too_far',
          'That exam is more than four months away. Ask again closer to the date.',
        );
      const due = examDate ? dueAll.filter((d) => ymd(d.dueAt) <= examDate!) : dueAll;
      try {
        const roster = members.map((m) => ({ id: m.id, name: m.name }));
        const boxes = new Map(roster.map((m) => [m.id, ctx.boxes(m.id, courseId!)]));
        const busyDays = new Map(roster.map((m) => [m.id, ctx.busyDays(m.id)]));
        // 1) the planner agent, when a real model is answering; 2) the labelled deterministic fallback.
        let gen: { items: PlanItem[]; citations: Plan['citations'] } | undefined;
        let generator: PlanGenerator | undefined;
        let rationale: string | undefined;
        let fallbackReason = llmReal() ? undefined : llmReason();
        if (planner && llmReal()) {
          try {
            const out = await planner({
              now,
              examDate,
              examLabel,
              courseId,
              courseTitle: ctx.courseTitle(courseId),
              members: roster,
              organizerId: v.studentId,
              chapters,
              pageText: (file, page) => ctx.pageText?.(courseId!, file, page),
              due,
              context: ctx.contextItems?.(v, courseId) ?? [],
              boxes,
              busyDays,
              newId: id10,
            });
            gen = { items: out.items, citations: out.citations };
            rationale = out.rationale;
            const ports = portsReal();
            generator = {
              kind: 'agent',
              mode: ports ? 'live' : 'degraded',
              ...(ports ? {} : { reason: 'some hub ports are stubbed, the planner agent still ran' }),
              source: 'planner',
              model: out.model,
              ...(out.usage ? { usage: out.usage } : {}),
              note: `Written by the planner agent (${out.model}) from your course pages, due dates and each member's free days.`,
            };
            if (out.repaired.length)
              deps.log.info('plan: planner output repaired', { n: out.repaired.length });
          } catch (e) {
            fallbackReason =
              e instanceof PlannerError ? e.reason : `the planner failed (${(e as Error).name})`;
            deps.log.warn('plan: planner failed, using the fallback generator', {
              reason: fallbackReason,
            });
          }
        } else if (!planner && llmReal()) fallbackReason = 'no planner agent is attached';
        if (!gen) {
          gen = generateItems({
            now,
            members: roster,
            organizerId: v.studentId,
            chapters,
            boxes,
            busyDays,
            due,
            contextDue: (() => {
              const base =
                ctx.contextDue?.(
                  v.squadId,
                  roster.map((m) => m.id),
                  now,
                  horizon,
                ) ?? [];
              const refs = body.contextSourceIds?.length
                ? (ctx.contextRefs?.(v, body.contextSourceIds) ?? [])
                : [];
              return (refs.length ? [...base.filter((d) => d.ownerId !== v.studentId), ...refs] : base).filter(
                (d) => !examDate || ymd(d.dueAt) <= examDate,
              );
            })(),
            examDate,
            newId: id10,
          });
          const degraded = llmReal(); // a real model exists but the agent did not deliver
          generator = {
            kind: 'fallback',
            mode: degraded ? 'degraded' : 'demo',
            reason: fallbackReason ?? 'no live model',
            source: 'fallback-generator',
            note: degraded
              ? `Fallback sample plan: the planner agent did not deliver (${fallbackReason}), so this is the scripted chapter-by-chapter schedule.`
              : `Fallback sample plan: scripted, not written by an agent (${fallbackReason ?? 'no live model'}). Built from the course chapters and due dates.`,
          };
        }
        if (prior) {
          prior.status = 'cancelled';
          log(prior, v.studentId, 'replaced by a new plan');
          store.save(prior);
          emitChange(prior, 'replaced');
        }
        const pm: PlanMember[] = roster.map((m) => ({
          ...m,
          optedIn: true,
          response: m.id === v.studentId ? 'accepted' : 'pending',
        }));
        const plan: Plan = {
          id: `pl_${id10()}`,
          squadId: v.squadId,
          courseId,
          title: `${ctx.courseTitle(courseId)} study plan`,
          status: 'proposed',
          organizerId: v.studentId,
          examDate,
          examLabel,
          rev: 1,
          items: gen.items,
          members: pm,
          conflicts: [],
          citations: gen.citations,
          generator: generator!,
          ...(rationale ? { rationale } : {}),
          createdAt: now,
          updatedAt: now,
          log: [],
        };
        log(plan, v.studentId, 'plan proposed');
        activateIfReady(plan, v.studentId, 'organizer only'); // a one-person squad needs nobody else
        store.save(plan);
        emitChange(plan, 'proposed');
        const badge = planBadge(plan.generator);
        const cites = [...new Set(plan.citations.map((c) => c.label))].slice(0, 6).join(', ');
        const tail =
          plan.status === 'active'
            ? 'It is active.'
            : `${REPLY_HELP} It starts when everyone has accepted or ${nameOf(v.studentId)} confirms.`;
        return {
          ok: true,
          plan,
          say: {
            text:
              `${nameOf(v.studentId)} proposed a study plan: ${examWords(plan, now)}, ${plural(plan.items.length, 'item')}.\n` +
              `${lines(plan)}\n${badge.kindLabel} (${badge.label}). ${plan.rationale ? `Why: ${plan.rationale}\n` : ''}` +
              `Built from: ${cites || 'your course materials'}. ${plan.generator.note}\n${tail}`,
            card: cardOf(plan),
            ...provenanceOf(plan),
          },
        };
      } catch (e) {
        deps.log.error('plan generation failed', { err: (e as Error).name });
        return fail(
          500,
          'generation_failed',
          'I could not build the plan this time. Please try again in a minute.',
        );
      }
    },

    respond(v, planId, r) {
      const p = store.get(planId);
      if (!own(v, p)) return fail(404, 'not_found', 'No such plan.');
      if (p.status !== 'proposed')
        return fail(409, 'plan_closed', 'This plan is not waiting for answers.', { plan: p });
      const me = p.members.find((m) => m.id === v.studentId);
      if (!me || !me.optedIn) return fail(403, 'forbidden', 'You are not part of this plan.');
      if (r === 'decline' && v.studentId === p.organizerId)
        return fail(409, 'organizer_cannot_decline', 'You started this plan. Cancel it instead.', {
          plan: p,
        });
      let text: string;
      if (r === 'accept') {
        me.response = 'accepted';
        p.rev += 1;
        log(p, v.studentId, 'accepted');
        text = `${me.name} accepted the plan.`;
      } else {
        me.response = 'declined';
        me.optedIn = false;
        const moved = rebalance(p, v.studentId, v.studentId, nameOf);
        if (moved === 0) p.rev += 1;
        log(p, v.studentId, 'declined');
        text =
          `${me.name} declined. ${moved ? `Their ${moved} item${moved === 1 ? ' was' : 's were'} shared out among the others.` : ''}`.trim();
      }
      const activated = activateIfReady(p, v.studentId, 'everyone accepted');
      const { accepted, total } = countsOf(p);
      text += activated
        ? ' Everyone has answered, so the plan is active.'
        : ` ${accepted} of ${total} accepted.`;
      store.save(p);
      emitChange(p, activated ? 'activated' : r);
      return { ok: true, plan: p, say: { text, card: cardOf(p) } };
    },

    addItem(v, input) {
      const p = store.current(v.squadId);
      if (!p)
        return fail(
          409,
          'no_plan',
          'There is no study plan yet. Ask Nook to make one first, then add this.',
        );
      const me = p.members.find((m) => m.id === v.studentId);
      if (!me || !me.optedIn) return fail(403, 'forbidden', 'You are not part of this plan.');
      const title = input.title.trim().slice(0, 120);
      if (!title) return fail(422, 'invalid_item', 'The item has no text.');
      if (p.items.some((i) => i.title.toLowerCase() === title.toLowerCase()))
        return { ok: true, plan: p, say: { text: '' } };
      const today = ymd(deps.now());
      const last = p.examDate ? addDays(p.examDate, -1) : addDays(today, 14);
      const date = daysBetween(today, last) >= 1 ? addDays(today, 1) : last;
      p.rev += 1;
      const item: PlanItem = {
        id: id10(),
        ownerId: v.studentId,
        ownerName: me.name,
        kind: 'practice',
        title,
        ...(input.detail ? { topic: input.detail.trim().slice(0, 120) } : {}),
        date,
        durationMin: 30,
        status: 'todo',
        rev: p.rev,
        updatedBy: v.studentId,
        sources: [],
      };
      p.items.push(item);
      log(p, v.studentId, `added ${title}${input.source ? ` (${input.source})` : ''}`);
      store.save(p);
      emitChange(p, 'add');
      return {
        ok: true,
        plan: p,
        say: {
          text: `${me.name} added "${title}" to the study plan (${fmtDate(date)}).`,
          card: cardOf(p),
        },
      };
    },

    edit(v, planId, itemId, baseRev, patch) {
      const p = store.get(planId);
      if (!own(v, p)) return fail(404, 'not_found', 'No such plan.');
      if (!p.members.some((m) => m.id === v.studentId && m.optedIn))
        return fail(403, 'forbidden', 'You are not part of this plan.');
      const out = editItem(p, itemId, baseRev, patch, {
        by: v.studentId,
        now: deps.now(),
        newId: id10,
        nameOf,
        isMember: (id) => p.members.some((m) => m.id === id && m.optedIn),
      });
      if (out.kind === 'rejected') {
        const st =
          out.code === 'not_found'
            ? 404
            : out.code === 'conflict_open'
              ? 409
              : out.code === 'plan_closed'
                ? 409
                : 422;
        return fail(st, out.code, out.message, { plan: p });
      }
      if (out.kind === 'conflict') {
        const item = p.items.find((i) => i.id === itemId)!;
        const cf = out.conflict;
        const show = (f: typeof cf.theirs) =>
          `${nameOf(f.ownerId)}, ${fmtDate(f.date)}, ${f.durationMin} min`;
        log(p, v.studentId, `edit conflict on ${item.title}`);
        store.save(p);
        emitChange(p, 'conflict');
        const say: PlanSay = {
          text:
            `Edit conflict on "${item.title}": ${nameOf(cf.theirsBy)} and ${nameOf(cf.mineBy)} changed it at the same time. ` +
            `Current: ${show(cf.theirs)}. ${nameOf(cf.mineBy)} wanted: ${show(cf.mine)}. ` +
            'Nothing was overwritten. Open the Study plan in the village and pick one version.',
          card: cardOf(p),
        };
        return fail(
          409,
          'conflict',
          'Someone changed this item first. Both versions are kept until one is picked.',
          {
            plan: p,
            conflictId: cf.id,
            say,
          },
        );
      }
      if (!out.changed) return { ok: true, plan: p, say: { text: '' } };
      log(p, v.studentId, `edited ${out.item.title}`);
      store.save(p);
      emitChange(p, 'edit');
      return {
        ok: true,
        plan: p,
        say: {
          text: `${nameOf(v.studentId)} updated "${out.item.title}": ${out.item.ownerName}, ${fmtDate(out.item.date)}, ${out.item.durationMin} min.`,
          card: cardOf(p),
        },
      };
    },

    editByRef(v, ref, to) {
      const p = store.current(v.squadId);
      if (!p) return fail(404, 'not_found', 'There is no plan yet.');
      const hits = matchItems(p.items, ref);
      if (hits.length !== 1)
        return fail(
          422,
          hits.length ? 'ambiguous' : 'not_found',
          hits.length
            ? `"${ref}" matches ${plural(hits.length, 'item')}. Use the chapter, like "plan 3 ch6 to Dev".`
            : `I could not find an item called "${ref}".`,
          { plan: p },
        );
      const item = hits[0]!;
      const date = parseExamDate(to, deps.now());
      const person = p.members.find(
        (m) =>
          m.optedIn && (m.name.toLowerCase() === to || m.name.toLowerCase().split(' ')[0] === to),
      );
      const patch: PlanItemPatch | undefined = person
        ? { ownerId: person.id }
        : date
          ? { date }
          : undefined;
      if (!patch)
        return fail(422, 'invalid_request', `I could not read "${to}" as a person or a date.`, {
          plan: p,
        });
      return service.edit(v, p.id, item.id, item.rev, patch);
    },

    resolve(v, planId, conflictId, pick) {
      const p = store.get(planId);
      if (!own(v, p)) return fail(404, 'not_found', 'No such plan.');
      if (!p.members.some((m) => m.id === v.studentId && m.optedIn))
        return fail(403, 'forbidden', 'You are not part of this plan.');
      const cf = resolveConflict(p, conflictId, pick, v.studentId, nameOf);
      if (!cf) return fail(404, 'not_found', 'That conflict is already resolved.', { plan: p });
      const item = p.items.find((i) => i.id === cf.itemId);
      log(p, v.studentId, `picked ${pick} for ${item?.title ?? 'an item'}`);
      store.save(p);
      emitChange(p, 'resolved');
      const who = pick === 'mine' ? cf.mineBy : cf.theirsBy;
      return {
        ok: true,
        plan: p,
        say: {
          text: `${nameOf(v.studentId)} settled the conflict on "${item?.title ?? 'an item'}" with ${nameOf(who)}'s version.`,
          card: cardOf(p),
        },
      };
    },

    confirm(v, planId) {
      const p = store.get(planId);
      if (!own(v, p)) return fail(404, 'not_found', 'No such plan.');
      if (v.studentId !== p.organizerId)
        return fail(
          403,
          'organizer_only',
          `Only ${nameOf(p.organizerId)} can start the plan early.`,
          { plan: p },
        );
      if (p.status !== 'proposed')
        return fail(409, 'plan_closed', 'This plan is not waiting to start.', { plan: p });
      p.status = 'active';
      p.rev += 1;
      const waiting = p.members.filter((m) => m.optedIn && m.response === 'pending');
      log(p, v.studentId, 'confirmed by organizer');
      store.save(p);
      emitChange(p, 'activated');
      return {
        ok: true,
        plan: p,
        say: {
          text: `${nameOf(v.studentId)} started the plan.${waiting.length ? ` Still to answer: ${waiting.map((m) => m.name).join(', ')}. Everyone can still accept or decline.` : ''}`,
          card: cardOf(p),
        },
      };
    },

    cancel(v, planId) {
      const p = store.get(planId);
      if (!own(v, p)) return fail(404, 'not_found', 'No such plan.');
      if (v.studentId !== p.organizerId)
        return fail(403, 'organizer_only', `Only ${nameOf(p.organizerId)} can cancel the plan.`, {
          plan: p,
        });
      if (!open(p)) return fail(409, 'plan_closed', 'This plan is already closed.', { plan: p });
      p.status = 'cancelled';
      p.rev += 1;
      log(p, v.studentId, 'cancelled');
      store.save(p);
      emitChange(p, 'cancelled');
      return {
        ok: true,
        plan: p,
        say: { text: `${nameOf(v.studentId)} cancelled the study plan.`, card: cardOf(p) },
      };
    },

    done(v, planId, itemId, done) {
      const p = store.get(planId);
      if (!own(v, p)) return fail(404, 'not_found', 'No such plan.');
      const item = p.items.find((i) => i.id === itemId);
      if (!item) return fail(404, 'not_found', 'No such item.', { plan: p });
      if (!open(p)) return fail(409, 'plan_closed', 'This plan is closed.', { plan: p });
      if (item.ownerId !== v.studentId && v.studentId !== p.organizerId)
        return fail(403, 'forbidden', 'Only the owner can mark this item done.', { plan: p });
      const want = done ? 'done' : 'todo';
      if (item.status === want) return { ok: true, plan: p, say: { text: '' } };
      item.status = want;
      p.rev += 1;
      item.rev = p.rev;
      item.updatedBy = v.studentId;
      log(p, v.studentId, `${want} ${item.title}`);
      store.save(p);
      emitChange(p, 'done');
      const nDone = p.items.filter((i) => i.status === 'done').length;
      return {
        ok: true,
        plan: p,
        say: {
          text: done
            ? `${nameOf(v.studentId)} finished "${item.title}". ${planProgressWords(nDone, p.items.length)}.`
            : `${nameOf(v.studentId)} reopened "${item.title}". ${planProgressWords(nDone, p.items.length)}.`,
          card: cardOf(p),
        },
      };
    },

    doneByRef(v, ref) {
      const p = store.current(v.squadId);
      if (!p || !open(p)) return fail(404, 'not_found', 'There is no open plan to mark.');
      const mine = p.items.filter((i) => i.ownerId === v.studentId);
      const hits = matchItems(
        mine.filter((i) => i.status === 'todo'),
        ref,
      );
      if (hits.length === 1) return service.done(v, p.id, hits[0]!.id, true);
      if (hits.length > 1)
        return fail(
          422,
          'ambiguous',
          `"${ref}" matches ${hits.length} of your items: ${hits.map((i) => i.title).join('; ')}. Say which one.`,
          { plan: p },
        );
      const finished = matchItems(
        mine.filter((i) => i.status === 'done'),
        ref,
      );
      if (finished.length)
        return fail(409, 'already_done', `"${finished[0]!.title}" is already marked done.`, {
          plan: p,
        });
      return fail(404, 'not_found', `I could not find "${ref}" among your open plan items.`, {
        plan: p,
      });
    },

    view(v, p) {
      const optedIn = p.members.filter((m) => m.optedIn);
      const me = p.members.find((m) => m.id === v.studentId);
      const done = p.items.filter((i) => i.status === 'done').length;
      const myBusy = ctx.busyDays(v.studentId);
      const dates = [...new Set(p.items.map((i) => i.date))].sort();
      const small = deps.directory.isSmall(p.squadId);
      const squadBusy = small ? undefined : new Map(optedIn.map((m) => [m.id, ctx.busyDays(m.id)]));
      const weak = [...ctx.boxes(v.studentId, p.courseId)]
        .filter(([, box]) => box <= 2)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([c]) => c);
      const { log: _log, ...rest } = p;
      void _log;
      return {
        ...rest,
        me: {
          id: v.studentId,
          response: me?.response ?? 'pending',
          optedIn: me?.optedIn ?? false,
          isOrganizer: v.studentId === p.organizerId,
        },
        countdown: p.examDate
          ? {
              days: daysBetween(ymd(deps.now()), p.examDate),
              words: planCountdownWords(daysBetween(ymd(deps.now()), p.examDate)),
            }
          : null,
        progress: { done, total: p.items.length, words: planProgressWords(done, p.items.length) },
        load: optedIn.map((m) => {
          const mine = p.items.filter((i) => i.ownerId === m.id);
          return {
            memberId: m.id,
            name: m.name,
            items: mine.length,
            done: mine.filter((i) => i.status === 'done').length,
            minutes: mine.reduce((a, i) => a + i.durationMin, 0),
          };
        }),
        availability: {
          mine: p.items
            .filter((i) => i.ownerId === v.studentId)
            .map((i) => ({ itemId: i.id, busy: myBusy.has(i.date) })),
          squad: squadBusy
            ? dates.map((date) => ({
                date,
                total: optedIn.length,
                free: optedIn.filter((m) => !squadBusy.get(m.id)!.has(date)).length,
              }))
            : null,
        },
        myWeakTopics: weak,
        replyHelp: REPLY_HELP,
        saved: {
          rev: p.rev,
          lastEditedBy: nameOf(p.log[p.log.length - 1]?.by ?? p.organizerId),
          lastEditedAt: p.updatedAt,
        },
        sync: (() => {
          // the posted message is recorded on the stored plan after the caller's copy was taken
          const posted = store.get(p.id)?.posted ?? p.posted;
          return {
            posted: posted ? { at: posted.at, text: posted.text } : null,
            imessage: posted ? imessageStateOf(posted.messageId) : ('off' as const),
          };
        })(),
      };
    },

    privateNote(v, p) {
      const view = service.view(v, p);
      const busy = view.availability.mine.filter((x) => x.busy).length;
      const mineItems = p.items.filter((i) => i.ownerId === v.studentId);
      return (
        `Your part of the plan: ${mineItems.map((i) => `${i.chapter ?? i.title} (${fmtDate(i.date)})`).join(', ') || 'nothing yet'}.` +
        (busy ? ` ${busy} of your items fall on a day your calendar shows as busy.` : '') +
        (view.myWeakTopics.length
          ? ` Your shakiest chapters: ${view.myWeakTopics.join(', ')}.`
          : '')
      );
    },
  };
  void fieldsOf;
  return service;
}
