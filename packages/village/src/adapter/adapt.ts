import { safeParseVillageEvent } from '@squad/core';
import type { VillageEvent } from '@squad/core';
import type { AdapterContext, Place, SceneCommand } from './commands';
import { agentName, chapterName, dwellMs, kindWords, shortCaption, studentName } from './labels';

/**
 * VillageEvent -> SceneCommand[]. Pure and deterministic: no Phaser, no clock, no randomness.
 *
 * Privacy: `ledger.entry` is the only event that can sit next to a withheld value. Withheld and
 * blocked entries emit the field label only; any `shared` that rides along is ignored. The event
 * schema is strict, so unknown keys never get this far (see adaptUnknown). `agent.message.shared`
 * labels and council/caption text are shareable by contract and are shown as given.
 */

const isAlertKind = (k: string): k is 'conflict' | 'option_dropped' | 'query_denied' =>
  k === 'conflict' || k === 'option_dropped' || k === 'query_denied';

const COMMONS: Place = { kind: 'commons' };
const door = (agent: string): Place => ({ kind: 'door', agent });
const studentAgent = (student: string) => `student:${student}`;

export function adapt(event: VillageEvent, ctx: AdapterContext): SceneCommand[] {
  switch (event.t) {
    case 'agent.state': {
      const out: SceneCommand[] = [
        { type: 'setAgentState', agent: event.agent, state: event.state },
        { type: 'ring', agent: event.agent, on: event.state === 'waiting_for_student' },
      ];
      const who = agentName(event.agent);
      const words = {
        idle: `${who} is resting`,
        studying: `${who} is studying`,
        in_call: `${who} is on a call`,
        waiting_for_student: `${who} is waiting for a yes`,
      }[event.state];
      out.push({ type: 'announce', text: words, politeness: 'polite' });
      return out;
    }

    case 'agent.message': {
      const kindText = kindWords(event.kind);
      const fromMediator = event.from === 'mediator';
      const alert = isAlertKind(event.kind) ? event.kind : undefined;
      const out: SceneCommand[] = [];
      const id = `env:${event.taskId}:${event.from}:${event.to}:${event.kind}`;
      if (!fromMediator) {
        out.push({
          type: 'spawnEnvelope',
          id,
          from: event.from,
          to: event.to,
          taskId: event.taskId,
          kind: event.kind,
        });
        out.push({ type: 'walkTo', agent: event.from, to: COMMONS, carrying: id });
      }
      out.push({
        type: 'showBubble',
        key: `msg:${id}`,
        at: COMMONS,
        style: 'speech',
        text: kindText,
        lines: event.shared,
        minMs: dwellMs([kindText, ...event.shared].join(' ')),
      });
      if (alert) {
        out.push({
          type: 'marker',
          at: COMMONS,
          reason: alert,
          key: `alert:${event.taskId}:${event.kind}`,
        });
      }
      if (event.kind === 'query_denied') {
        out.push({
          type: 'ledgerCard',
          taskId: event.taskId,
          student: fromMediator ? 'mediator' : event.from,
          card: { kind: 'blocked', field: 'request' },
        });
      }
      const speaker = fromMediator ? 'The mediator' : agentName(event.from);
      out.push({
        type: 'announce',
        text: alert
          ? `${kindText}.`
          : event.shared.length > 0
            ? `${speaker} shared ${event.shared.join(', ')}.`
            : `${speaker} sent a message.`,
        politeness: event.kind === 'conflict' ? 'assertive' : 'polite',
      });
      return out;
    }

    case 'ledger.entry': {
      const who = studentName(event.student);
      if (event.blocked) {
        return [
          {
            type: 'ledgerCard',
            taskId: event.taskId,
            student: event.student,
            card: { kind: 'blocked', field: event.field },
          },
          {
            type: 'marker',
            at: door(studentAgent(event.student)),
            reason: 'blocked',
            key: `blocked:${event.taskId}:${event.student}:${event.field}`,
          },
          {
            type: 'announce',
            text: `Blocked by privacy gate: ${who}'s ${event.field}.`,
            politeness: 'assertive',
          },
        ];
      }
      if (event.withheld === 'hidden' || event.shared === undefined) {
        return [
          {
            type: 'ledgerCard',
            taskId: event.taskId,
            student: event.student,
            card: { kind: 'hidden', field: event.field },
          },
          {
            type: 'announce',
            text: `${who} kept ${event.field} hidden.`,
            politeness: 'polite',
          },
        ];
      }
      return [
        {
          type: 'ledgerCard',
          taskId: event.taskId,
          student: event.student,
          card: { kind: 'shared', field: event.field, shared: event.shared },
        },
        {
          type: 'announce',
          text: `${who} shared ${event.field}: ${event.shared}.`,
          politeness: 'polite',
        },
      ];
    }

    case 'confirm.pending': {
      const agent = studentAgent(event.student);
      const out: SceneCommand[] = [{ type: 'ring', agent, on: true }];
      if (event.student === ctx.me) {
        out.push({
          type: 'openOverlay',
          request: { overlay: 'openConfirm', taskId: event.taskId, question: event.question },
        });
      }
      out.push({
        type: 'announce',
        text: `${studentName(event.student)}'s agent is waiting for a yes: ${event.question}`,
        politeness: 'polite',
      });
      return out;
    }

    case 'confirm.done': {
      const agent = studentAgent(event.student);
      const out: SceneCommand[] = [
        { type: 'ring', agent, on: false },
        { type: 'tick', at: door(agent) },
      ];
      if (event.student === ctx.me) {
        out.push({
          type: 'openOverlay',
          request: { overlay: 'close', which: 'confirm', taskId: event.taskId },
        });
      }
      out.push({
        type: 'announce',
        text: `${studentName(event.student)} said yes.`,
        politeness: 'polite',
      });
      return out;
    }

    case 'council.opinion': {
      const text = event.text ?? '';
      return [
        { type: 'councilOpinion', councilId: event.councilId, member: event.member, text },
        {
          type: 'announce',
          text: text ? `${event.member}: ${text}` : `${event.member} has an opinion.`,
          politeness: 'polite',
        },
      ];
    }

    case 'council.rank':
      return [
        {
          type: 'councilRank',
          councilId: event.councilId,
          member: event.member,
          order: event.order ?? [],
        },
        {
          type: 'announce',
          text: event.order?.length
            ? `${event.member} ranks: ${event.order.join(', ')}.`
            : `${event.member} ranked the answers.`,
          politeness: 'polite',
        },
      ];

    case 'council.verdict': {
      const text = event.text ?? '';
      const dissenter = event.dissenter ?? (event.dissent ? event.member : undefined);
      const out: SceneCommand[] = [
        {
          type: 'councilVerdict',
          councilId: event.councilId,
          member: event.member,
          text,
          ...(dissenter ? { dissenter } : {}),
        },
      ];
      if (dissenter) {
        out.push({ type: 'lantern', councilId: event.councilId, flicker: true });
      }
      out.push({
        type: 'announce',
        text: `Council verdict: ${text || 'decided'}.${dissenter ? ' One member dissented: uncertain, ask your TA.' : ''}`,
        politeness: dissenter ? 'assertive' : 'polite',
      });
      return out;
    }

    case 'quiz.question': {
      const out: SceneCommand[] = [
        { type: 'chalkboard', chapter: event.chapter, mark: 'question' },
      ];
      if (event.target === ctx.me) {
        out.push({
          type: 'openOverlay',
          request: { overlay: 'openQuiz', quizId: event.quizId, chapter: event.chapter },
        });
      }
      out.push({
        type: 'announce',
        text: `Quiz question on ${chapterName(event.chapter)}.`,
        politeness: 'polite',
      });
      return out;
    }

    case 'quiz.answer': {
      const mark = event.correct === undefined ? 'none' : event.correct ? 'tick' : 'cross';
      return [
        { type: 'chalkboard', chapter: event.chapter, mark },
        {
          type: 'announce',
          text: `A quiz answer came in for ${chapterName(event.chapter)}.`,
          politeness: 'polite',
        },
      ];
    }

    case 'quiz.result': {
      const mark = event.correct === undefined ? 'none' : event.correct ? 'tick' : 'cross';
      return [
        { type: 'chalkboard', chapter: event.chapter, mark },
        {
          type: 'announce',
          text: `Quiz round finished for ${chapterName(event.chapter)}.`,
          politeness: 'polite',
        },
      ];
    }

    case 'call.start': {
      const out: SceneCommand[] = [
        {
          type: 'callPortrait',
          agent: event.agent,
          on: true,
          ...(event.student ? { student: event.student } : {}),
        },
        { type: 'setAgentState', agent: event.agent, state: 'in_call' },
      ];
      if (event.student !== undefined && event.student === ctx.me) {
        out.push({
          type: 'openOverlay',
          request: { overlay: 'openCall', agent: event.agent, callId: event.callId },
        });
      }
      out.push({
        type: 'announce',
        text: `${agentName(event.agent)} started a call.`,
        politeness: 'polite',
      });
      return out;
    }

    case 'call.caption': {
      const text = shortCaption(event.text ?? '');
      if (!text) return [];
      return [
        {
          type: 'showBubble',
          key: `caption:${event.callId}`,
          at: { kind: 'agent', agent: event.agent },
          style: 'caption',
          text,
          minMs: dwellMs(text),
        },
      ];
    }

    case 'call.end':
      return [
        { type: 'dismissBubble', key: `caption:${event.callId}` },
        { type: 'callPortrait', agent: event.agent, on: false },
        { type: 'setAgentState', agent: event.agent, state: 'idle' },
        { type: 'openOverlay', request: { overlay: 'close', which: 'call', callId: event.callId } },
        {
          type: 'announce',
          text: `${agentName(event.agent)} ended the call.`,
          politeness: 'polite',
        },
      ];

    case 'trip.confirmed':
      return [
        { type: 'playTrip', taskId: event.taskId, squadId: event.squadId },
        { type: 'announce', text: 'Everyone said yes. Trip confirmed.', politeness: 'assertive' },
      ];

    case 'mastery.changed':
      if (event.student !== ctx.me) return [];
      return [
        { type: 'setGlow', chapter: event.chapter, box: event.box },
        {
          type: 'announce',
          text: `${chapterName(event.chapter)} is getting stronger.`,
          politeness: 'polite',
        },
      ];

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return [];
    }
  }
}

export interface AdaptRejection {
  readonly reason: string;
  readonly input: unknown;
}

/**
 * Trust-boundary entry: validates with the shared strict schema first. Malformed, unknown or
 * over-sharing events (extra keys) are dropped, reported through `onReject`, and never throw.
 */
export function adaptUnknown(
  input: unknown,
  ctx: AdapterContext,
  onReject?: (r: AdaptRejection) => void,
): SceneCommand[] {
  const parsed = safeParseVillageEvent(input);
  if (!parsed.success) {
    // Report the issue paths only, never echo input values (they might be withheld values).
    onReject?.({
      reason: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`)
        .join('; '),
      input: undefined,
    });
    return [];
  }
  return adapt(parsed.data, ctx);
}
