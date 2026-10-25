import { readFile } from 'node:fs/promises';
import type { AgentId, Citation, StudentId } from '@squad/core';
import { INTERNAL_HEADER } from '@squad/core';
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
} from './types';

export const MAX_USER_TEXT = 1000;
export const MAX_HISTORY = 12;

export type SpeakingEmitter = (e: {
  agent: AgentId;
  speaking: boolean;
  callId: string;
}) => void | Promise<void>;

/** Posts the hub extension envelope `x.persona.speaking` (docs/hub-api.md section 4). Never throws. */
export function hubSpeakingEmitter(
  opts: { baseUrl?: string; secret?: string; fetch?: typeof fetch } = {},
): SpeakingEmitter {
  return async (e) => {
    const base = (opts.baseUrl ?? process.env.HUB_BASE_URL ?? 'http://localhost:8788').replace(
      /\/+$/,
      '',
    );
    const secret =
      opts.secret ?? process.env.INTERNAL_EVENTS_SECRET ?? process.env.NOOK_INTERNAL_SECRET ?? '';
    try {
      await (opts.fetch ?? fetch)(`${base}/internal/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [INTERNAL_HEADER]: secret },
        body: JSON.stringify({ type: 'x.persona.speaking', data: e }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      /* the hub being down must not break a call */
    }
  };
}

export interface CallPortOptions {
  tts: Pick<TtsService, 'speak'>;
  answer: AnswerFn;
  /** Persona id used to pick the voice for an agent id; default derives from the AgentId. */
  personaFor?: (agent: AgentId) => string;
  greeting?: (agent: AgentId) => string;
  transcriber?: Transcriber;
  emit?: SpeakingEmitter;
  budget?: BudgetGuard;
  /** Delay before the speaking=false event after the last audio turn. Default 1000 ms. */
  speakingTailMs?: number;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
  knownAgent?: (agent: AgentId) => boolean;
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
  const tail = o.speakingTailMs ?? 1000;
  return {
    async open({ callId, agent, student }) {
      if (o.knownAgent && !o.knownAgent(agent)) return null;
      return new Session(o, callId, agent, student, tail);
    },
  };
}

class Session implements CallSession {
  private readonly history: HistoryItem[] = [];
  private chunks: Uint8Array[] = [];
  private readonly chunkMime = 'audio/webm';
  private speaking = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly o: CallPortOptions,
    private readonly callId: string,
    private readonly agent: AgentId,
    private readonly student: StudentId,
    private readonly tailMs: number,
  ) {}

  private persona(): string {
    return (this.o.personaFor ?? defaultPersonaFor)(this.agent);
  }

  private setSpeaking(on: boolean) {
    if (this.speaking === on) return;
    this.speaking = on;
    void this.o.emit?.({ agent: this.agent, speaking: on, callId: this.callId });
  }

  private scheduleStop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.setSpeaking(false), this.tailMs);
  }

  private async turn(s: AnswerSentence): Promise<CallTurn> {
    const text = s.text;
    const base: CallTurn = { text, ...(s.cite ? { cite: s.cite as Citation } : {}) };
    try {
      const r = await this.o.tts.speak(this.persona(), text);
      const data = new Uint8Array(await readFile(r.path));
      this.setSpeaking(true);
      if (this.timer) clearTimeout(this.timer);
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
      if (this.speaking) this.scheduleStop();
    }
  }

  greeting(): AsyncIterable<CallTurn> {
    const text = (this.o.greeting ?? defaultGreeting)(this.agent);
    this.history.push({ who: 'agent', text });
    return this.speak(toIter([{ text }]));
  }

  reply(userText: string): AsyncIterable<CallTurn> {
    const text = userText.trim();
    if (!text || this.closed) return toIter([]) as unknown as AsyncIterable<CallTurn>;
    const clipped = text.slice(0, MAX_USER_TEXT);
    this.history.push({ who: 'you', text: clipped });
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
    if (this.timer) clearTimeout(this.timer);
    this.setSpeaking(false);
  }
}

export type { Session as MediaCallSession };
