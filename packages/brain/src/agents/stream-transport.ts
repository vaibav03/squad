import type { Llm, LlmMessage, LlmPart, LlmTool } from '@squad/core';
import type {
  AgentSession,
  AgentTransport,
  OpenSessionOptions,
  SendOptions,
  StepResult,
  ToolDecl,
  ToolResultInput,
} from './types';

/**
 * Default real transport: one conversation per agent over the provider-agnostic Llm layer (Gemini
 * `generateContent` with function calling). The Llm adapter drops thinking parts (core/llm/thoughts.ts) before
 * anything here sees text, and this class never lets text outside a tool call escape: the runtime only trusts
 * `submit_turn`.
 *
 * `llm` MUST be the raw provider (GeminiLlm), not the ResilientLlm: a council never silently swaps to the
 * hub's demo model mid-run (plan 5.1).
 */
export function createStreamTextTransport(llm: Llm): AgentTransport {
  return {
    kind: 'stream-text',
    open(o: OpenSessionOptions): AgentSession {
      const history: LlmMessage[] = [];
      let closed = false;
      const declare = (tools: ToolDecl[]): LlmTool[] =>
        tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
      return {
        async send(input: string | ToolResultInput[], so: SendOptions = {}): Promise<StepResult> {
          if (closed) throw new Error('reason:session_closed');
          history.push(
            typeof input === 'string'
              ? { role: 'user', content: input }
              : {
                  role: 'user',
                  content: input.map((r): LlmPart => ({
                    type: 'tool_result',
                    id: r.id,
                    name: r.name,
                    result: r.result,
                  })),
                },
          );
          const res = await llm.complete({
            model: o.spec.tier,
            system: o.system,
            messages: history,
            tools: declare(so.tools ?? o.tools),
            maxToolRounds: 0, // the runtime owns the loop
            maxTokens: o.maxOutputTokens,
            ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
            ...(so.signal ? { signal: so.signal } : {}),
          });
          history.push({
            role: 'assistant',
            content: [
              ...(res.text || res.toolCalls.length === 0
                ? [{ type: 'text' as const, text: res.text || '(no output)' }]
                : []),
              ...res.toolCalls.map((c) => ({ type: 'tool_call' as const, ...c })),
            ],
          });
          return {
            text: res.text,
            toolCalls: res.toolCalls,
            ...(res.usage ? { usage: res.usage } : {}),
          };
        },
        close() {
          closed = true;
        },
      };
    },
  };
}
