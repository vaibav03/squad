// The hub's side of the chat skill's PlanPort: chat replies map onto the plan service, so chat, web and REST all share
// one object and one conflict rule. The skill sends the group-visible text itself; nothing here posts to the group.
import type { PlanPort, PlanSayOut } from '@squad/bot';
import type { PlanReply } from '@squad/core';
import type { HubDeps, Viewer } from '../types';
import type { PlanResult } from './service';

export function createPlanPort(deps: Pick<HubDeps, 'plans' | 'log'>): PlanPort {
  const plans = deps.plans;
  const viewer = (studentId: string, squadId: string): Viewer => ({
    studentId,
    squadId,
    projector: false,
  });
  const out = (v: Viewer, res: PlanResult, withPrivate = false): PlanSayOut => {
    const say = res.ok ? res.say : res.say;
    const text = say?.text || (res.ok ? '' : res.message);
    const card = say?.card;
    const citations = say?.citations;
    const provenance = say?.provenance;
    const priv = withPrivate && res.plan ? plans.privateNote(v, res.plan) : undefined;
    return {
      ok: res.ok,
      text,
      ...(card ? { card } : {}),
      ...(citations?.length ? { citations } : {}),
      ...(provenance ? { provenance } : {}),
      ...(priv ? { privateText: priv } : {}),
    };
  };
  const fail = (e: unknown): PlanSayOut => {
    deps.log.error('plan chat action failed', { err: (e as Error)?.name });
    return {
      ok: false,
      text: 'Something went wrong with the study plan. Nothing was changed. Please try again.',
    };
  };

  return {
    async propose(studentId, squadId, o) {
      const v = viewer(studentId, squadId);
      try {
        return out(v, await plans.propose(v, o.examDate ? { examDate: o.examDate } : {}), true);
      } catch (e) {
        return fail(e);
      }
    },
    async reply(studentId, squadId, r: PlanReply) {
      const v = viewer(studentId, squadId);
      try {
        const cur = plans.current(v);
        switch (r.kind) {
          case 'show':
            return cur
              ? {
                  ok: true,
                  text: plans.summary(cur),
                  card: { type: 'plan', planId: cur.id, rev: cur.rev, status: cur.status },
                  ...plans.provenanceOf(cur),
                }
              : {
                  ok: false,
                  text: 'There is no study plan yet. Say "@cubbie study plan for the exam on Nov 4" to start one.',
                };
          case 'accept':
          case 'decline':
            return cur
              ? out(v, plans.respond(v, cur.id, r.kind), r.kind === 'accept')
              : { ok: false, text: 'There is no study plan waiting for an answer.' };
          case 'confirm':
            return cur
              ? out(v, plans.confirm(v, cur.id))
              : { ok: false, text: 'There is no study plan to start.' };
          case 'edit':
            return out(v, plans.editByRef(v, r.ref, r.to));
        }
      } catch (e) {
        return fail(e);
      }
    },
    async done(studentId, squadId, ref) {
      const v = viewer(studentId, squadId);
      try {
        return out(v, plans.doneByRef(v, ref));
      } catch (e) {
        return fail(e);
      }
    },
    state(studentId, squadId) {
      const v = viewer(studentId, squadId);
      const s = plans.hasOpen(v);
      return { ...s, ownsOpen: (ref: string) => plans.matchOwnOpen(v, ref).length > 0 };
    },
  };
}
