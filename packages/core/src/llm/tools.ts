import type { LlmMessage, LlmRequest, LlmResult, LlmTool } from './types';
import { normalizeMessages } from './types';

/**
 * Shared tool loop used by every adapter: calls `step` (one model turn), runs any tool that has
 * `execute`, appends call/result messages and repeats. Calls to tools without `execute` are
 * returned to the caller in `toolCalls`.
 */
export async function completeWithTools(
  req: LlmRequest,
  step: (messages: LlmMessage[]) => Promise<LlmResult>,
): Promise<LlmResult> {
  const tools = new Map<string, LlmTool>((req.tools ?? []).map((t) => [t.name, t]));
  const messages = [...normalizeMessages(req.messages)];
  const max = req.maxToolRounds ?? 5;
  for (let round = 0; ; round++) {
    const res = await step(messages);
    const runnable = res.toolCalls.filter((c) => tools.get(c.name)?.execute);
    if (runnable.length === 0 || round >= max) return res;
    messages.push({
      role: 'assistant',
      content: [
        ...(res.text ? [{ type: 'text' as const, text: res.text }] : []),
        ...res.toolCalls.map((c) => ({ type: 'tool_call' as const, ...c })),
      ],
    });
    const results = await Promise.all(
      res.toolCalls.map(async (c) => {
        const tool = tools.get(c.name);
        const result = tool?.execute
          ? await tool.execute(tool.parameters.parse(c.args))
          : { error: `tool ${c.name} not executable` };
        return { type: 'tool_result' as const, id: c.id, name: c.name, result };
      }),
    );
    messages.push({ role: 'user', content: results });
  }
}
