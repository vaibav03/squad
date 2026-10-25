// FakeLive: deterministic scripted discussion. No network, no long timers (FAKE_LIVE_SPEED ms per word, 0 in tests).
import type { LivePersonaId } from '@squad/core';
import { parseRelay, type ParsedRelay } from './protocol';
import { fakeSpeedFromEnv } from './env';
import type { LiveAgentClient, LiveAgentHandlers, LiveConnectOptions } from './types';

const quote = (s: string, n = 5): string => s.split(/\s+/).slice(0, n).join(' ');

/** A short verbatim phrase from the first source (so a citation can be verified against the page). */
function phraseOf(p: ParsedRelay): { phrase: string; marker: string } | undefined {
  const s = p.sources[0];
  if (!s) return undefined;
  const sentence = s.text.split(/(?<=[.!?])\s+/).find((x) => x.split(/\s+/).length >= 6) ?? s.text;
  const words = sentence
    .replace(/^(NOTE|EXAMPLE|TRY IT)\s+/i, '')
    .split(/\s+/)
    .slice(0, 8);
  return { phrase: words.join(' ').replace(/[.,;:]+$/, ''), marker: `[${s.file} p.${s.page}]` };
}

export function scriptFor(persona: LivePersonaId, p: ParsedRelay): string {
  const next = p.next ?? 'Chair';
  const src = phraseOf(p);
  const cite = src ? ` ${src.marker}` : '';
  const topic = p.topic.length > 70 ? `${p.topic.slice(0, 67)}...` : p.topic;
  const ack = p.user ? `You said "${quote(p.user.text)}". ` : '';
  const hand = ` ${next}, over to you.`;

  if (p.close) {
    return persona === 'chair'
      ? `To wrap up: we agreed that the core idea behind ${topic} matters most${src ? ' and it is in the course notes' : ''}. The Skeptic wants more evidence before we trust it. Next steps: re-read the source, do three practice problems, then quiz yourself. Thanks for listening.`
      : `Closing thought on ${topic}: stay curious and check the source.`;
  }
  if (p.user) {
    const k = p.user.kind;
    const lead =
      k === 'lost'
        ? `${ack}No problem, let me slow down. The idea is simple: ${src ? `${src.phrase}${cite}` : 'start from the definition and build up'}.`
        : k === 'simpler'
          ? `${ack}Simply put, ${src ? `${src.phrase}${cite}` : topic}, think of it as an everyday example.`
          : k === 'disagree'
            ? `${ack}Fair challenge. Here is the case for the other side, and where the evidence is thin${cite}.`
            : k === 'summarize'
              ? `${ack}Quick summary so far: we are on ${topic}, we have one core idea, and one open doubt.`
              : `${ack}Good point, let me take that on for ${topic}${cite}.`;
    return `${lead}${hand}`;
  }
  switch (persona) {
    case 'chair':
      return p.turn <= 1
        ? `Welcome. Today we are discussing ${topic}. Let us start with the core idea.${hand}`
        : `Let us pull this together. We agree on the basics, and one doubt is still open.${hand}`;
    case 'tutor':
      return `The core idea of ${topic} is this: ${src ? `${src.phrase}${cite}` : 'begin with the plain definition'}. That is the anchor to remember.${hand}`;
    case 'skeptic':
      return `I am not fully convinced yet. What is the evidence, and when does this break down?${hand}`;
    case 'planner':
      return `Here is a plan: first re-read the source${cite}, then try three practice problems, then check yourself.${hand}`;
    case 'examiner':
      return `A test would ask: in your own words, what does ${topic} mean, and when does it apply?${hand}`;
  }
}

function sinePcm(ms = 120, rate = 24000, amp = 0.04): string {
  const n = Math.floor((rate * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amp * 32767), i * 2);
  return buf.toString('base64');
}
const CHUNK = sinePcm();

export interface FakeLiveOptions {
  /** ms per word; default FAKE_LIVE_SPEED env (25, 0 under vitest). */
  speedMs?: number;
}

export class FakeLive implements LiveAgentClient {
  private h: LiveAgentHandlers = {};
  private persona: LivePersonaId = 'chair';
  private gen = 0;
  private closed = false;
  private readonly speed: number;
  constructor(opts: FakeLiveOptions = {}) {
    this.speed = opts.speedMs ?? fakeSpeedFromEnv();
  }

  connect(o: LiveConnectOptions): Promise<void> {
    this.h = o.handlers;
    this.persona = o.persona;
    return Promise.resolve();
  }

  sendText(text: string): void {
    if (this.closed) return;
    const gen = ++this.gen;
    void this.speak(gen, scriptFor(this.persona, parseRelay(text)));
  }

  interrupt(): void {
    this.gen += 1;
  }

  close(): void {
    this.closed = true;
    this.gen += 1;
    this.h.close?.();
  }

  private async tick(): Promise<void> {
    if (this.speed <= 0) await Promise.resolve();
    else await new Promise<void>((r) => setTimeout(r, this.speed));
  }

  private async speak(gen: number, script: string): Promise<void> {
    const sentences = script.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [script];
    for (const s of sentences) {
      this.h.audio?.(CHUNK);
      const words = s.match(/\S+\s*/g) ?? [];
      for (const w of words) {
        await this.tick();
        if (gen !== this.gen || this.closed) return;
        this.h.outputTranscript?.(w);
      }
    }
    await this.tick();
    if (gen !== this.gen || this.closed) return;
    this.h.turnComplete?.();
  }
}
