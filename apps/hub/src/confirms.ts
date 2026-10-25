import type { HubDeps, StudentId, Viewer } from './types';

export interface ConfirmAnswer {
  yes: boolean;
  /** Required for trip tasks (the option being confirmed). */
  optionId?: string;
}

export type ConfirmOutcome =
  | { ok: true; status?: string }
  | {
      ok: false;
      code:
        | 'unknown_task'
        | 'unsupported_kind'
        | 'invalid_request'
        | 'upstream_failed'
        | 'already_answered'
        | 'expired';
      message?: string;
    };

/** Viewer-scoped preview of an open confirm (GET /v1/confirms/:taskId). */
export interface ConfirmPreview {
  taskId: string;
  question: string;
  options: string[];
  kind: string;
  mode: 'pick' | 'yesno';
  /** Epoch ms when the question stops accepting answers. */
  expiresAt?: number;
  /** Original ask for "Ask again" (see ChatCard.reask). */
  reask?: { chatId: string; text: string };
}

/** Why a task that is visible to the viewer can no longer be answered. */
export interface ConfirmClosed {
  state: 'expired' | 'answered';
  answer?: string;
  /** Original ask, so a closed card can still offer "Ask again". */
  reask?: { chatId: string; text: string };
}

/** One kind of confirmable task. `owns` must be cheap and side-effect free. */
export interface ConfirmHandler {
  kind: string;
  owns(taskId: string, viewer: Viewer): boolean;
  answer(viewer: Viewer, taskId: string, a: ConfirmAnswer): Promise<ConfirmOutcome>;
  /** Optional: what to show for this task (question + options). */
  preview?(viewer: Viewer, taskId: string): ConfirmPreview | undefined;
  /** Optional: the closed state (expired / answered) of a task the viewer owns. */
  closed?(viewer: Viewer, taskId: string): ConfirmClosed | undefined;
  /** Optional DEV/E2E: expire every open confirm of the viewer through the normal timeout path. */
  expireAll?(viewer: Viewer): number;
}

export interface ConfirmRouter {
  /** Preview for the viewer's own open confirm; undefined (404) for unknown tasks and other students' tasks. */
  preview(viewer: Viewer, taskId: string): ConfirmPreview | undefined;
  /** Expired / already-answered state of the viewer's own task (undefined = open or unknown). */
  closed(viewer: Viewer, taskId: string): ConfirmClosed | undefined;
  /** DEV/E2E only: times out the viewer's open confirms; returns how many. */
  expireAll(viewer: Viewer): number;
  register(h: ConfirmHandler): void;
  /** Where each student's mesh agent listens (for the `agent` handler); unset = that kind is unsupported. */
  setAgentUrls(urls: Record<string, string>): void;
  answer(viewer: Viewer, taskId: string, a: ConfirmAnswer): Promise<ConfirmOutcome>;
}

/**
 * Generic confirm dispatch. A task is answered only by a handler that owns it; anything else fails closed
 * (`unknown_task`), and a task that is visible to the viewer but has no wiring answers `unsupported_kind`.
 * Built-ins: `trip` (the trip store) and `agent` (an open confirm.pending card, answered through the
 * student's own mesh agent at POST /internal/confirm/answer).
 */
export function createConfirmRouter(
  deps: HubDeps,
  o: { fetch?: typeof fetch } = {},
): ConfirmRouter {
  const handlers: ConfirmHandler[] = [];
  let agentUrls: Record<string, string> = {};

  const trip: ConfirmHandler = {
    kind: 'trip',
    owns: (taskId, v) => {
      const t = deps.trips.byTask(taskId);
      return !!t && deps.trips.view(t.tripId, v, { directory: deps.directory }) !== null;
    },
    async answer(v, taskId, a) {
      const t = deps.trips.byTask(taskId);
      if (!t) return { ok: false, code: 'unknown_task' };
      if (t.collab) {
        // Collaborative trips: the trip service owns confirmation (rules, chat summary, trip.confirmed once).
        const r = deps.tripSvc.confirm(v, t.tripId, {
          yes: a.yes,
          ...(a.optionId ? { optionId: a.optionId } : {}),
        });
        if (r.ok) return { ok: true, status: r.trip.status };
        return r.status === 404
          ? { ok: false, code: 'unknown_task' }
          : { ok: false, code: 'invalid_request', message: r.message };
      }
      if (!a.optionId) return { ok: false, code: 'invalid_request', message: 'optionId required' };
      const rec = deps.trips.confirm(t.tripId, v.studentId, a.optionId, a.yes);
      if (!rec) return { ok: false, code: 'unknown_task' };
      deps.ingest.village({
        t: 'confirm.done',
        student: v.studentId,
        taskId: rec.taskId,
        question: 'Confirm trip',
      });
      deps.ingest.x('x.trip.touch', { tripId: t.tripId });
      if (deps.trips.allConfirmed(t.tripId))
        deps.ingest.village({ t: 'trip.confirmed', taskId: rec.taskId, squadId: rec.squadId });
      return { ok: true, status: rec.status };
    },
  };

  const agent: ConfirmHandler = {
    kind: 'agent',
    owns: (taskId, v) => deps.state.pendingConfirm(v.studentId, taskId) !== undefined,
    preview(v, taskId) {
      const p = deps.state.pendingConfirm(v.studentId, taskId);
      return p
        ? { taskId, question: p.question, options: ['Yes', 'No'], kind: 'agent', mode: 'yesno' }
        : undefined;
    },
    async answer(v, taskId, a) {
      const url = agentUrls[v.studentId];
      if (!url) return { ok: false, code: 'unsupported_kind', message: 'no agent wired' };
      try {
        const res = await (o.fetch ?? fetch)(`${url.replace(/\/+$/, '')}/internal/confirm/answer`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Nook-Internal': deps.config.internalSecret,
          },
          body: JSON.stringify({ taskId, answer: a.yes ? 'yes' : 'no' }),
          signal: AbortSignal.timeout(3000),
        });
        if (res.status === 404) return { ok: false, code: 'unknown_task' };
        if (!res.ok) return { ok: false, code: 'upstream_failed' };
        return { ok: true };
      } catch {
        return { ok: false, code: 'upstream_failed' };
      }
    },
  };

  handlers.push(trip, agent);
  return {
    register: (h) => void handlers.unshift(h),
    setAgentUrls: (u) => void (agentUrls = { ...u }),
    preview(viewer, taskId) {
      return handlers.find((x) => x.owns(taskId, viewer))?.preview?.(viewer, taskId);
    },
    closed(viewer, taskId) {
      return handlers.find((x) => x.owns(taskId, viewer))?.closed?.(viewer, taskId);
    },
    expireAll(viewer) {
      return handlers.reduce((n, h) => n + (h.expireAll?.(viewer) ?? 0), 0);
    },
    async answer(viewer, taskId, a) {
      const h = handlers.find((x) => x.owns(taskId, viewer));
      if (!h) return { ok: false, code: 'unknown_task' };
      return h.answer(viewer, taskId, a);
    },
  };
}

export type { StudentId };
