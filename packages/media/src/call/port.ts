import { readFile } from 'node:fs/promises';
import type { AgentId, Citation, StudentId } from '@squad/core';
import type { BudgetGuard } from '../tts/budget';
import { sentences, type TtsService } from '../tts/service';
import type { Transcriber } from './transcribe';
import type {
  AnswerFn,
  AnswerSentence,
  CallPort,
  CallSession,
  CallTurn,
  HistoryItem,
  ScriptedAgent,
} from './types';

export const MAX_USER_TEXT = 1000;
export const MAX_HISTORY = 12;

export interface CallPortOptions {
  tts: Pick<TtsService, 'speak'>;
  answer: AnswerFn;
  /** Persona id used to pick the voice for an agent id; default derives from the AgentId. */
  personaFor?: (agent: AgentId) => string;
  greeting?: (agent: AgentId) => string;
  transcriber?: Transcriber;
  budget?: BudgetGuard;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
  knownAgent?: (agent: AgentId) => boolean;
  /** Per-call scripted agent (e.g. the oral examiner). undefined = the normal greeting/answer path. */
  agentFor?: (args: { callId: string; agent: AgentId; student: StudentId }) => ScriptedAgent | undefined;
}

export function defaultPersonaFor(agent: AgentId): string {
  return agent; // VoiceService.resolve maps `expert:ch5`, `council:2`, `dean` onto profiles by role
}

function defaultGreeting(agent: AgentId): string {
  if (agent.startsWith('expert:'))
    return 'Hi, I am the chapter expert. Ask me anything about this chapter.';
  if (agent === 'dean') return 'Welcome. What would you like to discuss?';
  return 'Hi! What do you want to go over?';
}

async function* toIter(
  r: AsyncIterable<AnswerSentence> | AnswerSentence[],
): AsyncIterable<AnswerSentence> {
  for await (const x of r as AsyncIterable<AnswerSentence>) yield x;
}

/**
 * CallPort for the hub. Each answer sentence becomes one CallTurn (caption + cached audio clip), so
 * captions always lead audio and clips queue gap-free in the browser. If TTS or its budget fails the
 * turn still carries text: the call degrades to captions only.
 */
export function createCallPort(o: CallPortOptions): CallPort {
  return {
    async open({ callId, agent, student }) {
      if (o.knownAgent && !o.knownAgent(agent)) return null;
      return new Session(o, callId, agent, student, o.agentFor?.({ callId, agent, student }));
    },
  };
}

class Session implements CallSession {
  private readonly history: HistoryItem[] = [];
  private chunks: Uint8Array[] = [];
  private readonly chunkMime = 'audio/webm';
  private closed = false;

  constructor(
    private readonly o: CallPortOptions,
    private readonly callId: string,
    private readonly agent: AgentId,
    private readonly student: StudentId,
    private readonly scripted?: ScriptedAgent,
  ) {}

  finished(): boolean {
    return this.scripted?.done?.() ?? false;
  }

  private persona(): string {
    return (this.o.personaFor ?? defaultPersonaFor)(this.agent);
  }

  private async turn(s: AnswerSentence): Promise<CallTurn> {
    const text = s.text;
    const base: CallTurn = { text, ...(s.cite ? { cite: s.cite as Citation } : {}) };
    try {
      const r = await this.o.tts.speak(this.persona(), text);
      const data = new Uint8Array(await readFile(r.path));
      return { ...base, audio: { mime: r.mime, data } };
    } catch (e) {
      this.o.log?.('call tts unavailable, captions only', {
        callId: this.callId,
        reason: e instanceof Error ? e.name : 'error',
      });
      return base;
    }
  }

  private async *speak(src: AsyncIterable<AnswerSentence>): AsyncIterable<CallTurn> {
    try {
      for await (const s of src) {
        if (this.closed) return;
        // A single answer item may hold several sentences; split so captions stay per sentence.
        const parts: string[] = [];
        for await (const p of sentences(s.text)) parts.push(p);
        for (const [i, text] of parts.entries()) {
          if (this.closed) return;
          yield await this.turn({
            text,
            ...(s.cite && i === parts.length - 1 ? { cite: s.cite } : {}),
          });
        }
      }
    } finally {
      /* nothing to flush */
    }
  }

  private async *scriptedTurns(
    get: () => Promise<AnswerSentence[]>,
  ): AsyncIterable<CallTurn> {
    const lines = await get();
    const out: string[] = [];
    for await (const t of this.speak(toIter(lines))) {
      out.push(t.text);
      yield t;
    }
    if (out.length) this.history.push({ who: 'agent', text: out.join(' ') });
  }

  greeting(): AsyncIterable<CallTurn> {
    if (this.scripted) {
      const a = this.scripted;
      return this.scriptedTurns(() => a.greeting());
    }
    const text = (this.o.greeting ?? defaultGreeting)(this.agent);
    this.history.push({ who: 'agent', text });
    return this.speak(toIter([{ text }]));
  }

  reply(userText: string): AsyncIterable<CallTurn> {
    const text = userText.trim();
    if (!text || this.closed) return toIter([]) as unknown as AsyncIterable<CallTurn>;
    const clipped = text.slice(0, MAX_USER_TEXT);
    this.history.push({ who: 'you', text: clipped });
    if (this.scripted) {
      const a = this.scripted;
      return this.scriptedTurns(() => a.reply(clipped, this.history.slice(-MAX_HISTORY)));
    }
    return this.answerTurns(clipped);
  }

  private async *answerTurns(clipped: string): AsyncIterable<CallTurn> {
    {
      const got = await this.o.answer({
        agent: this.agent,
        student: this.student,
        text: clipped,
        history: this.history.slice(-MAX_HISTORY),
      });
      const out: string[] = [];
      for await (const t of this.speak(
        toIter(got as AsyncIterable<AnswerSentence> | AnswerSentence[]),
      )) {
        out.push(t.text);
        yield t;
      }
      this.history.push({ who: 'agent', text: out.join(' ') });
    }
  }

  audio(chunk: Uint8Array): void {
    // Buffered in memory only; flushed by `transcribeBuffered`. Capped at the inline limit.
    const size = this.chunks.reduce((n, c) => n + c.length, 0);
    if (size + chunk.length <= 19 * 1024 * 1024) this.chunks.push(chunk);
  }

  /** Transcribe buffered mic audio (push-to-talk release) and answer it. Mic bytes are dropped after. */
  async *replyToAudio(): AsyncIterable<CallTurn> {
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) {
      buf.set(c, off);
      off += c.length;
    }
    this.chunks = [];
    if (!this.o.transcriber || total === 0) return;
    const text = await this.o.transcriber.transcribe(buf, this.chunkMime);
    if (text) yield* this.reply(text);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.chunks = [];
  }
}

export type { Session as MediaCallSession };
