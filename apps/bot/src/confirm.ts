import type { ConfirmAnswer, Db, InboundMessage, StudentId } from '@squad/core';
import { parseConfirmReply } from './confirm-parse';
import { nullLogger } from './log';
import type { ConfirmApi, EventPublisher, Logger } from './types';

export const DEFAULT_CONFIRM_TIMEOUT_MS = 600_000;
const REPROMPT_EVERY_MS = 30_000;

export interface ConfirmDeps {
  db: Db;
  dm: (student: StudentId, text: string) => Promise<void>;
  /** Transports with structured prompts (web cards) show the question themselves instead of the numbered DM text. */
  prompt?: (
    student: StudentId,
    p: { taskId: string; question: string; options: string[] },
  ) => Promise<void>;
  /** Called once when a pending confirm resolves (answer is the option string or 'timeout'). */
  resolved?: (student: StudentId, taskId: string, answer: ConfirmAnswer) => void;
  events: EventPublisher;
  now?: () => number;
  timeoutMs?: number;
  log?: Logger;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

interface Entry {
  student: StudentId;
  question: string;
  options: string[];
  taskId: string;
  resolve(a: ConfirmAnswer): void;
  reject(e: Error): void;
  timer?: ReturnType<typeof setTimeout>;
  rowId?: number;
  ready: boolean;
  /** ts of the last "did not catch that" reply (at most one per REPROMPT_EVERY_MS) */
  repromptedAt?: number;
}

export function formatConfirmDm(question: string, options: string[]): string {
  const list = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
  const n = options.length;
  const how =
    n === 1
      ? 'Reply 1 to confirm.'
      : n === 2
        ? 'Reply 1 or 2.'
        : `Reply ${options
            .slice(0, -1)
            .map((_, i) => i + 1)
            .join(', ')} or ${n}.`;
  return `${question}\n\n${list}\n\n${how}`;
}

export function createConfirmManager(deps: ConfirmDeps): ConfirmApi {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  const log = deps.log ?? nullLogger;
  const setT = deps.setTimer ?? setTimeout;
  const clearT = deps.clearTimer ?? clearTimeout;
  const active = new Map<StudentId, Entry>();
  const queues = new Map<StudentId, Entry[]>();

  // Unanswered rows from a previous process can never resolve: drop them.
  deps.db.prepare('DELETE FROM pending_confirms WHERE answer IS NULL OR expires_at < ?').run(now());

  const emit = (e: Parameters<EventPublisher['publish']>[0]) => {
    deps.events
      .publish(e)
      .catch((err: Error) => log.error({ err: err.message }, 'event publish failed'));
  };

  function advance(student: StudentId) {
    const next = queues.get(student)?.shift();
    if (next) void start(next);
  }

  function finish(entry: Entry, answer: ConfirmAnswer) {
    if (active.get(entry.student) !== entry) return; // already resolved: no double resolve
    if (entry.timer) clearT(entry.timer);
    active.delete(entry.student);
    if (entry.rowId !== undefined) {
      deps.db.prepare('UPDATE pending_confirms SET answer=? WHERE id=?').run(answer, entry.rowId);
    }
    emit({
      t: 'confirm.done',
      student: entry.student,
      taskId: entry.taskId,
      question: entry.question,
    });
    emit({ t: 'agent.state', agent: `student:${entry.student}`, state: 'idle' });
    log.info({ student: entry.student, taskId: entry.taskId, answer }, 'confirm resolved');
    try {
      deps.resolved?.(entry.student, entry.taskId, answer);
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'confirm resolved hook failed');
    }
    entry.resolve(answer);
    advance(entry.student);
  }

  async function start(entry: Entry) {
    active.set(entry.student, entry);
    const r = deps.db
      .prepare(
        'INSERT INTO pending_confirms(student_id, question, options_json, expires_at) VALUES(?,?,?,?)',
      )
      .run(entry.student, entry.question, JSON.stringify(entry.options), now() + timeoutMs);
    entry.rowId = Number(r.lastInsertRowid);
    emit({ t: 'agent.state', agent: `student:${entry.student}`, state: 'waiting_for_student' });
    emit({
      t: 'confirm.pending',
      student: entry.student,
      taskId: entry.taskId,
      question: entry.question,
    });
    try {
      if (deps.prompt) {
        await deps.prompt(entry.student, {
          taskId: entry.taskId,
          question: entry.question,
          options: entry.options,
        });
      } else {
        await deps.dm(entry.student, formatConfirmDm(entry.question, entry.options));
      }
    } catch (err) {
      active.delete(entry.student);
      deps.db.prepare('DELETE FROM pending_confirms WHERE id=?').run(entry.rowId);
      emit({
        t: 'confirm.done',
        student: entry.student,
        taskId: entry.taskId,
        question: entry.question,
      });
      emit({ t: 'agent.state', agent: `student:${entry.student}`, state: 'idle' });
      entry.reject(err as Error);
      advance(entry.student);
      return;
    }
    entry.ready = true;
    entry.timer = setT(() => finish(entry, 'timeout'), timeoutMs);
  }

  return {
    ask(student, question, options, taskId) {
      if (options.length === 0)
        return Promise.reject(new Error('askConfirm needs at least one option'));
      const q = queues.get(student) ?? [];
      queues.set(student, q);
      const dup = [active.get(student), ...q].some((e) => e?.taskId === taskId);
      if (dup)
        return Promise.reject(
          new Error(`duplicate pending confirm taskId "${taskId}" for ${student}`),
        );
      return new Promise<ConfirmAnswer>((resolve, reject) => {
        const entry: Entry = {
          student,
          question,
          options,
          taskId,
          resolve,
          reject,
          ready: false,
        };
        if (active.has(student)) q.push(entry);
        else void start(entry);
      });
    },
    tryConsume(m: InboundMessage) {
      if (m.isGroup) return false;
      const entry = active.get(m.from);
      if (!entry?.ready) return false;
      const p = parseConfirmReply(m.text, entry.options);
      if (p.kind === 'match') {
        finish(entry, p.option);
      } else if (
        entry.repromptedAt === undefined ||
        now() - entry.repromptedAt >= REPROMPT_EVERY_MS
      ) {
        entry.repromptedAt = now();
        deps
          .dm(
            entry.student,
            `Sorry, I did not catch that. ${formatConfirmDm('', entry.options).trim()}`,
          )
          .catch((err: Error) => log.warn({ err: err.message }, 'reprompt failed'));
      }
      return true;
    },
    cancel(student, taskId) {
      const a = active.get(student);
      if (a?.taskId === taskId) {
        finish(a, 'timeout');
        return true;
      }
      const q = queues.get(student);
      const i = q?.findIndex((e) => e.taskId === taskId) ?? -1;
      if (!q || i < 0) return false;
      const [e] = q.splice(i, 1);
      e!.resolve('timeout');
      return true;
    },
    hasPending(student) {
      return active.has(student) || (queues.get(student)?.length ?? 0) > 0;
    },
  };
}
