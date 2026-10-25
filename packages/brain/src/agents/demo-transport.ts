import { scripted, type LlmToolCall } from '@squad/core';
import type {
  AgentSession,
  AgentTransport,
  OpenSessionOptions,
  SendOptions,
  StepResult,
  ToolResultInput,
} from './types';

/** One scripted conversation. Gets every input the runtime sends and answers with tool calls. */
export type DemoSessionScript = (
  input: string | ToolResultInput[],
  o: SendOptions,
  state: { step: number },
) => StepResult;
/** Builds the scripted behaviour of one agent. Registered per council key (`ask`, `roundtable`, ...). */
export type DemoScript = (o: OpenSessionOptions) => DemoSessionScript;

const scripts = new Map<string, DemoScript>();
/** Registers the demo script of a council. Scripted text MUST be made with `demoText()` (the branded helper). */
export function registerDemoScript(councilKey: string, s: DemoScript): void {
  scripts.set(councilKey, s);
}

/** The only way demo scripts make visible text: branded, always labelled demo downstream. */
export const demoText = (text: string): string => scripted(text, 'demo').text;

let callSeq = 0;
export const demoCall = (name: string, args: Record<string, unknown>): LlmToolCall => ({
  id: `demo_${++callSeq}`,
  name,
  args,
});

export const councilKeyOf = (agentId: string): string =>
  (agentId.split(':')[1] ?? '').split('-')[0] ?? '';

/**
 * The scripted transport: deterministic, no model, no network. Used ONLY when a run's mode is `demo*`
 * (no key, forced, or health says the model is not usable at start). Every envelope it produces is
 * `source:'script'` and labelled by the runtime.
 */
export function createDemoTransport(): AgentTransport {
  return {
    kind: 'demo',
    open(o: OpenSessionOptions): AgentSession {
      const factory = scripts.get(councilKeyOf(o.spec.id));
      const script: DemoSessionScript = factory
        ? factory(o)
        : () => ({
            text: '',
            toolCalls: [
              demoCall('submit_turn', {
                summary: demoText('Scripted demo answer. No model was called.'),
                stance: 'demo',
                answer: 'demo',
              }),
            ],
          });
      const state = { step: 0 };
      return {
        async send(input, so = {}) {
          const r = script(input, so, state);
          state.step += 1;
          return r;
        },
        close() {},
      };
    },
  };
}
