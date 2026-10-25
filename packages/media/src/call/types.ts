import type { AgentId, Citation, StudentId } from '@squad/core';

/**
 * Structurally identical to the hub's ports (apps/hub/src/ports.ts, docs/hub-api.md section 11).
 * Declared locally so @squad/media does not import the hub; TypeScript checks compatibility at the
 * single wiring point in apps/hub/src/index.ts.
 */
export type CallTurn = {
  text: string;
  cite?: Citation;
  audio?: { mime: string; data: Uint8Array };
};

export interface CallSession {
  greeting(): AsyncIterable<CallTurn>;
  reply(userText: string): AsyncIterable<CallTurn>;
  audio?(chunk: Uint8Array): void;
  close(): Promise<void>;
}

export interface CallPort {
  open(args: { callId: string; agent: AgentId; student: StudentId }): Promise<CallSession | null>;
}

export interface HistoryItem {
  who: 'agent' | 'you';
  text: string;
}

export interface AnswerRequest {
  agent: AgentId;
  student: StudentId;
  text: string;
  history: HistoryItem[];
}

export interface AnswerSentence {
  text: string;
  cite?: Citation;
}

/**
 * The brain (03) supplies this. It must return ONLY text and an optional citation: the call path
 * forwards exactly that into captions, so a withheld value can only appear if the brain emits it.
 */
export type AnswerFn = (
  req: AnswerRequest,
) => AsyncIterable<AnswerSentence> | Promise<AnswerSentence[] | AsyncIterable<AnswerSentence>>;
