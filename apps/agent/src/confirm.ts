// askConfirm bridges. In-process (inside the bot) the spine's ctx.askConfirm is used as-is and emits the door-ring
// events itself. Standalone bridges below emit them, because nobody else will.
import { agentId, type AskConfirm } from '@squad/core';
import type { Emitter } from '@squad/mesh';
import { createInterface } from 'node:readline/promises';

export interface ConfirmOptions {
  emitter: Emitter;
  /** Scripted answers by student id: 'yes' | 'no' | 'timeout'. Default 'yes'. */
  answers?: Record<string, string>;
  /** POST target for the bot bridge: `${botUrl}/internal/confirm` (proposed to spine, see README). */
  botUrl?: string;
  secret?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type Answerer = (
  student: string,
  question: string,
  options: string[],
  taskId: string,
) => Promise<string>;

function wrap(emitter: Emitter, answer: Answerer): AskConfirm {
  return async (student, question, options, taskId) => {
    const agent = agentId.student(student);
    await emitter.emit({ t: 'agent.state', agent, state: 'waiting_for_student' });
    await emitter.emit({ t: 'confirm.pending', student, taskId, question });
    let a: string;
    try {
      a = await answer(student, question, options, taskId);
    } catch {
      a = 'timeout';
    }
    await emitter.emit({ t: 'confirm.done', student, taskId, question });
    await emitter.emit({ t: 'agent.state', agent, state: 'idle' });
    return a;
  };
}

export function scriptedConfirm(o: ConfirmOptions): AskConfirm {
  return wrap(o.emitter, async (s, _q, options) => {
    const a = o.answers?.[s] ?? 'yes';
    if (a === 'timeout') return 'timeout';
    return options.find((x) => x.toLowerCase() === a.toLowerCase()) ?? (a === 'yes' ? 'Yes' : 'No');
  });
}

export function botConfirm(o: ConfirmOptions & { botUrl: string }): AskConfirm {
  const f = o.fetch ?? fetch;
  return wrap(o.emitter, async (student, question, options, taskId) => {
    const res = await f(`${o.botUrl.replace(/\/+$/, '')}/internal/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Nook-Internal': o.secret ?? '' },
      body: JSON.stringify({ student, question, options, taskId }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 600_000),
    });
    if (!res.ok) return 'timeout';
    const j = (await res.json()) as { answer?: string };
    return typeof j.answer === 'string' ? j.answer : 'timeout';
  });
}

export function cliConfirm(o: ConfirmOptions): AskConfirm {
  return wrap(o.emitter, async (_s, question, options) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const a = await rl.question(`${question} [${options.join('/')}] `);
      return options.find((x) => x.toLowerCase().startsWith(a.trim().toLowerCase())) ?? 'timeout';
    } finally {
      rl.close();
    }
  });
}

/** Env-driven choice: BOT_URL => bridge; CONFIRM_ANSWERS ("s_ben=no,s_cam=timeout") => scripted; else CLI. */
export function confirmFromEnv(emitter: Emitter, env: NodeJS.ProcessEnv = process.env): AskConfirm {
  if (env.BOT_URL)
    return botConfirm({ emitter, botUrl: env.BOT_URL, secret: env.INTERNAL_EVENTS_SECRET ?? '' });
  if (env.CONFIRM_ANSWERS !== undefined || env.CONFIRM_MODE === 'scripted') {
    const answers = Object.fromEntries(
      (env.CONFIRM_ANSWERS ?? '')
        .split(',')
        .filter(Boolean)
        .map((kv) => kv.split('=') as [string, string]),
    );
    return scriptedConfirm({ emitter, answers });
  }
  return cliConfirm({ emitter });
}
