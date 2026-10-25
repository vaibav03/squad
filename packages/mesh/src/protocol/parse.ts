import { z } from 'zod';
import type { AgentMessage } from '@squad/core';
import { Label, PAYLOAD_SCHEMAS, isMessageKind, type MessageKind } from './schemas';

const Envelope = z.strictObject({
  from: Label,
  to: Label,
  taskId: Label,
  kind: z.string().max(32),
  payload: z.unknown(),
});

export type ParseResult =
  | { ok: true; msg: AgentMessage; kind: MessageKind }
  | { ok: false; error: 'envelope' | 'unknown_kind' | 'payload'; detail: string };

/** Strict envelope + per-kind payload validation. Unknown keys anywhere are a failure. */
export function parseMessage(raw: unknown): ParseResult {
  const env = Envelope.safeParse(raw);
  if (!env.success) return { ok: false, error: 'envelope', detail: env.error.issues[0]?.path.join('.') || 'envelope' };
  const { kind } = env.data;
  if (!isMessageKind(kind)) return { ok: false, error: 'unknown_kind', detail: 'kind' };
  const p = PAYLOAD_SCHEMAS[kind].safeParse(env.data.payload);
  if (!p.success) {
    const first = p.error.issues[0];
    // Path + code only: never echo the offending value (it may be the injected secret).
    return { ok: false, error: 'payload', detail: `${first?.path.join('.') ?? ''}:${first?.code ?? ''}` };
  }
  return {
    ok: true,
    kind,
    msg: { from: env.data.from, to: env.data.to, taskId: env.data.taskId, kind, payload: p.data },
  };
}
